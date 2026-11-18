// Package store contains the Postgres data access layer.
package store

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// DB is satisfied by GoFr's container.DB.
type DB interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

var ErrNotFound = errors.New("not found")

// Store is unscoped when ws is "" (internal use: ingestion, delivery worker) and
// limited to one workspace otherwise (every management API call).
type Store struct {
	db DB
	ws string
}

func New(db DB) *Store { return &Store{db: db} }

// In returns a copy of the store limited to one workspace.
func (s *Store) In(workspaceID string) *Store { return &Store{db: s.db, ws: workspaceID} }

func (s *Store) WorkspaceID() string { return s.ws }

// scope adds "col = <workspace>" to a list query; no-op for the unscoped store.
func (s *Store) scope(w *where, col string) {
	if s.ws != "" {
		w.add(col+" = ?", s.ws)
	}
}

// wsCond is an SQL fragment for single-row queries: "AND ($n::text = ” OR <col> = $n)".
func wsCond(n int, col string) string {
	p := "$" + strconv.Itoa(n)
	return " AND (" + p + "::text = '' OR " + col + " = " + p + ")"
}

type scanner interface {
	Scan(dest ...any) error
}

// jsonParam marshals v for a ::jsonb parameter (nil -> SQL NULL).
func jsonParam(v any) any {
	if v == nil {
		return nil
	}

	if raw, ok := v.(json.RawMessage); ok {
		if len(raw) == 0 || string(raw) == "null" {
			return nil
		}

		return string(raw)
	}

	b, err := json.Marshal(v)
	if err != nil || string(b) == "null" {
		return nil
	}

	return string(b)
}

func unmarshalNullable(b []byte, dst any) {
	if len(b) == 0 {
		return
	}

	_ = json.Unmarshal(b, dst)
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate key value")
}

// ---- query builder for list filters ----

type where struct {
	clauses []string
	args    []any
}

func (w *where) add(clause string, args ...any) {
	// clause uses "?" placeholders; rewrite to $n
	for _, a := range args {
		w.args = append(w.args, a)
		clause = strings.Replace(clause, "?", fmt.Sprintf("$%d", len(w.args)), 1)
	}

	w.clauses = append(w.clauses, clause)
}

// in adds "col IN (...)" for a comma-separated list.
func (w *where) in(col, csv string) {
	vals := splitCSV(csv)
	if len(vals) == 0 {
		return
	}

	ph := make([]string, len(vals))
	for i, v := range vals {
		w.args = append(w.args, v)
		ph[i] = fmt.Sprintf("$%d", len(w.args))
	}

	w.clauses = append(w.clauses, fmt.Sprintf("%s IN (%s)", col, strings.Join(ph, ",")))
}

func (w *where) sql() string {
	if len(w.clauses) == 0 {
		return ""
	}

	return " WHERE " + strings.Join(w.clauses, " AND ")
}

func (w *where) next() string { return fmt.Sprintf("$%d", len(w.args)+1) }

func splitCSV(s string) []string {
	var out []string

	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}

	return out
}

// ---- cursor pagination (created_at DESC, id DESC) ----

func encodeCursor(t time.Time, id string) *string {
	s := base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id))
	return &s
}

func decodeCursor(c string) (time.Time, string, bool) {
	b, err := base64.RawURLEncoding.DecodeString(c)
	if err != nil {
		return time.Time{}, "", false
	}

	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", false
	}

	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", false
	}

	return t, parts[1], true
}

func (w *where) cursor(tsCol, cursor string) {
	if cursor == "" {
		return
	}

	if t, id, ok := decodeCursor(cursor); ok {
		w.add("("+tsCol+", id) < (?, ?)", t, id)
	}
}

// ListParams are common list options.
type ListParams struct {
	Limit  int
	Cursor string
}

func (p ListParams) limit() int {
	if p.Limit <= 0 {
		return 50
	}

	if p.Limit > 250 {
		return 250
	}

	return p.Limit
}
