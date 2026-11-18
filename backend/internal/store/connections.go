package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
)

const connCols = `c.id, c.name, c.description, c.source_id, c.destination_id, c.rules, c.paused_at, c.disabled_at, c.created_at, c.updated_at`

// connSelect joins source and destination so a connection is returned fully expanded.
var connSelect = `SELECT ` + connCols + `, ` + prefixed("s", sourceCols) + `, ` + prefixed("d", destCols) +
	` FROM connections c JOIN sources s ON s.id=c.source_id JOIN destinations d ON d.id=c.destination_id`

func prefixed(alias, cols string) string {
	parts := strings.Split(cols, ",")
	for i, p := range parts {
		parts[i] = alias + "." + strings.TrimSpace(p)
	}

	return strings.Join(parts, ", ")
}

func scanConnection(s scanner) (*models.Connection, error) {
	var (
		c        models.Connection
		rules    []byte
		src      models.Source
		dst      models.Destination
		methods  string
		verif    []byte
		custom   []byte
		destAuth []byte
		srcCfg   []byte
	)

	err := s.Scan(&c.ID, &c.Name, &c.Description, &c.SourceID, &c.DestinationID, &rules, &c.PausedAt, &c.DisabledAt,
		&c.CreatedAt, &c.UpdatedAt,
		&src.ID, &src.Name, &src.Key, &src.Description, &methods, &verif, &custom, &src.DisabledAt, &src.CreatedAt, &src.UpdatedAt, &src.WorkspaceID, &src.Type, &srcCfg,
		&dst.ID, &dst.Name, &dst.Description, &dst.URL, &dst.HTTPMethod, &dst.AuthType, &destAuth, &dst.RateLimit,
		&dst.RateLimitPeriod, &dst.PathForwarding, &dst.DisabledAt, &dst.CreatedAt, &dst.UpdatedAt, &dst.Type)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	unmarshalNullable(rules, &c.Rules)

	if c.Rules == nil {
		c.Rules = []models.Rule{}
	}

	src.AllowedMethods = splitCSV(methods)
	unmarshalNullable(srcCfg, &src.Config)
	unmarshalNullable(verif, &src.Verification)
	unmarshalNullable(custom, &src.CustomResponse)
	src.URL = strings.TrimRight(IngestBaseURL, "/") + "/" + src.Key

	if len(destAuth) > 0 {
		dst.Auth = destAuth
	}

	c.Source, c.Destination = &src, &dst
	c.FullName = src.Name + " -> " + c.Name

	return &c, nil
}

func validateRules(rules []models.Rule) error {
	seen := map[string]bool{}

	for i, r := range rules {
		if seen[r.Type] {
			return apierr.BadRequest("rules[%d]: only one %q rule is allowed", i, r.Type)
		}

		seen[r.Type] = true

		switch r.Type {
		case "retry":
			if r.Strategy != "linear" && r.Strategy != "exponential" {
				return apierr.BadRequest("rules[%d]: retry.strategy must be linear or exponential", i)
			}

			if r.Count < 0 || r.Count > 50 {
				return apierr.BadRequest("rules[%d]: retry.count must be between 0 and 50", i)
			}

			if r.Interval <= 0 {
				return apierr.BadRequest("rules[%d]: retry.interval (ms) must be > 0", i)
			}
		case "filter":
		case "transform":
			if r.TransformationID == "" {
				return apierr.BadRequest("rules[%d]: transform.transformation_id is required", i)
			}
		case "delay":
			if r.Delay <= 0 || r.Delay > 86_400_000 {
				return apierr.BadRequest("rules[%d]: delay (ms) must be between 1 and 86400000", i)
			}
		default:
			return apierr.BadRequest("rules[%d]: unknown rule type %q (retry, filter, transform, delay)", i, r.Type)
		}
	}

	return nil
}

func (s *Store) checkTransformations(ctx context.Context, rules []models.Rule) error {
	for _, r := range rules {
		if r.Type == "transform" {
			if _, err := s.GetTransformation(ctx, r.TransformationID); err != nil {
				if errors.Is(err, ErrNotFound) {
					return apierr.BadRequest("transformation %q not found", r.TransformationID)
				}

				return err
			}
		}
	}

	return nil
}

func (s *Store) CreateConnection(ctx context.Context, in *models.ConnectionInput) (*models.Connection, error) {
	if in.Rules == nil {
		in.Rules = []models.Rule{}
	}

	if err := validateRules(in.Rules); err != nil {
		return nil, err
	}

	if err := s.checkTransformations(ctx, in.Rules); err != nil {
		return nil, err
	}

	srcID, err := s.resolveSource(ctx, in)
	if err != nil {
		return nil, err
	}

	dstID, err := s.resolveDestination(ctx, in)
	if err != nil {
		return nil, err
	}

	name := ""
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}

	if name == "" {
		d, err := s.GetDestination(ctx, dstID)
		if err != nil {
			return nil, err
		}

		name = d.Name
	}

	id := ids.New(ids.Connection)

	_, err = s.db.ExecContext(ctx, `INSERT INTO connections (id, name, description, source_id, destination_id, rules, workspace_id)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`, id, name, in.Description, srcID, dstID, jsonParam(in.Rules), s.ws)
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("source already has a connection named %q", name)
	}

	if err != nil {
		return nil, err
	}

	return s.GetConnection(ctx, id)
}

func (s *Store) resolveSource(ctx context.Context, in *models.ConnectionInput) (string, error) {
	switch {
	case in.SourceID != nil:
		if _, err := s.GetSource(ctx, *in.SourceID); err != nil {
			if errors.Is(err, ErrNotFound) {
				return "", apierr.BadRequest("source %q not found", *in.SourceID)
			}

			return "", err
		}

		return *in.SourceID, nil
	case in.Source != nil:
		src, err := s.UpsertSourceByName(ctx, in.Source)
		if err != nil {
			return "", err
		}

		return src.ID, nil
	}

	return "", apierr.BadRequest("source_id or source is required")
}

func (s *Store) resolveDestination(ctx context.Context, in *models.ConnectionInput) (string, error) {
	switch {
	case in.DestinationID != nil:
		if _, err := s.GetDestination(ctx, *in.DestinationID); err != nil {
			if errors.Is(err, ErrNotFound) {
				return "", apierr.BadRequest("destination %q not found", *in.DestinationID)
			}

			return "", err
		}

		return *in.DestinationID, nil
	case in.Destination != nil:
		d, err := s.UpsertDestinationByName(ctx, in.Destination)
		if err != nil {
			return "", err
		}

		return d.ID, nil
	}

	return "", apierr.BadRequest("destination_id or destination is required")
}

func (s *Store) GetConnection(ctx context.Context, id string) (*models.Connection, error) {
	return scanConnection(s.db.QueryRowContext(ctx, connSelect+` WHERE c.id=$1`+wsCond(2, "c.workspace_id"), id, s.ws))
}

type ConnectionFilter struct {
	Name          string
	SourceID      string
	DestinationID string
	Status        string // active | paused | disabled
}

func (s *Store) ListConnections(ctx context.Context, f ConnectionFilter, p ListParams) (*models.Page[models.Connection], error) {
	var w where

	s.scope(&w, "c.workspace_id")

	if f.Name != "" {
		w.add("(c.name ILIKE ? OR c.id = ? OR s.name ILIKE ? OR d.name ILIKE ?)", "%"+f.Name+"%", f.Name, "%"+f.Name+"%", "%"+f.Name+"%")
	}

	w.in("c.source_id", f.SourceID)
	w.in("c.destination_id", f.DestinationID)

	switch f.Status {
	case "active":
		w.add("c.paused_at IS NULL AND c.disabled_at IS NULL")
	case "paused":
		w.add("c.paused_at IS NOT NULL")
	case "disabled":
		w.add("c.disabled_at IS NOT NULL")
	}

	if p.Cursor != "" {
		if t, id, ok := decodeCursor(p.Cursor); ok {
			w.add("(c.created_at, c.id) < (?, ?)", t, id)
		}
	}

	rows, err := s.db.QueryContext(ctx, connSelect+w.sql()+` ORDER BY c.created_at DESC, c.id DESC LIMIT `+w.next(),
		append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Connection]{Models: []models.Connection{}}

	for rows.Next() {
		c, err := scanConnection(rows)
		if err != nil {
			return nil, err
		}

		page.Models = append(page.Models, *c)
	}

	return paginate(page, p.limit(), func(x models.Connection) (time.Time, string) { return x.CreatedAt, x.ID }), rows.Err()
}

// ActiveConnectionsForSource returns connections that should receive events from a source.
// Paused connections are included (their events are held); disabled ones are not.
func (s *Store) ActiveConnectionsForSource(ctx context.Context, sourceID string) ([]models.Connection, error) {
	rows, err := s.db.QueryContext(ctx, connSelect+` WHERE c.source_id=$1 AND c.disabled_at IS NULL
		AND d.disabled_at IS NULL ORDER BY c.created_at`, sourceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Connection

	for rows.Next() {
		c, err := scanConnection(rows)
		if err != nil {
			return nil, err
		}

		out = append(out, *c)
	}

	return out, rows.Err()
}

func (s *Store) UpdateConnection(ctx context.Context, id string, in *models.ConnectionInput) (*models.Connection, error) {
	c, err := s.GetConnection(ctx, id)
	if err != nil {
		return nil, err
	}

	name, desc, dstID, rules := c.Name, c.Description, c.DestinationID, c.Rules

	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}

	if in.Description != nil {
		desc = in.Description
	}

	if in.DestinationID != nil || in.Destination != nil {
		if dstID, err = s.resolveDestination(ctx, in); err != nil {
			return nil, err
		}
	}

	if in.Rules != nil {
		if err := validateRules(in.Rules); err != nil {
			return nil, err
		}

		if err := s.checkTransformations(ctx, in.Rules); err != nil {
			return nil, err
		}

		rules = in.Rules
	}

	_, err = s.db.ExecContext(ctx, `UPDATE connections SET name=$2, description=$3, destination_id=$4, rules=$5::jsonb,
		updated_at=now() WHERE id=$1`+wsCond(6, "workspace_id"), id, name, desc, dstID, jsonParam(rules), s.ws)
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("source already has a connection named %q", name)
	}

	if err != nil {
		return nil, err
	}

	return s.GetConnection(ctx, id)
}

// SetConnectionPaused pauses or resumes a connection. Resuming releases held events.
func (s *Store) SetConnectionPaused(ctx context.Context, id string, paused bool) (*models.Connection, error) {
	q := `UPDATE connections SET paused_at=NULL, updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id")
	if paused {
		q = `UPDATE connections SET paused_at=now(), updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id")
	}

	if err := execOne(ctx, s.db, q, id, s.ws); err != nil {
		return nil, err
	}

	if !paused {
		if _, err := s.db.ExecContext(ctx, `UPDATE events SET status='QUEUED', next_attempt_at=now(), updated_at=now()
			WHERE connection_id=$1 AND status='HOLD'`, id); err != nil {
			return nil, fmt.Errorf("releasing held events: %w", err)
		}
	}

	return s.GetConnection(ctx, id)
}

func (s *Store) SetConnectionDisabled(ctx context.Context, id string, disabled bool) (*models.Connection, error) {
	q := `UPDATE connections SET disabled_at=NULL, updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id")
	if disabled {
		q = `UPDATE connections SET disabled_at=now(), updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id")
	}

	if err := execOne(ctx, s.db, q, id, s.ws); err != nil {
		return nil, err
	}

	return s.GetConnection(ctx, id)
}

func (s *Store) DeleteConnection(ctx context.Context, id string) error {
	return execOne(ctx, s.db, `DELETE FROM connections WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws)
}
