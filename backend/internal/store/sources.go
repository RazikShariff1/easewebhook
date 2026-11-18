package store

import (
	"context"
	"encoding/json"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
	"github.com/zopping/easewebhook/backend/internal/sourcetypes"
)

// IngestBaseURL is prefixed to a source key to build its public URL.
var IngestBaseURL = "http://localhost:8000/e"

const sourceCols = `id, name, key, description, allowed_methods, verification, custom_response, disabled_at, created_at, updated_at, workspace_id, type, config`

func scanSource(s scanner) (*models.Source, error) {
	var (
		src           models.Source
		methods       string
		verif, custom []byte
		cfg           []byte
	)

	if err := s.Scan(&src.ID, &src.Name, &src.Key, &src.Description, &methods, &verif, &custom,
		&src.DisabledAt, &src.CreatedAt, &src.UpdatedAt, &src.WorkspaceID, &src.Type, &cfg); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	src.AllowedMethods = splitCSV(methods)
	unmarshalNullable(cfg, &src.Config)

	if src.Config == nil {
		src.Config = map[string]string{}
	}

	unmarshalNullable(verif, &src.Verification)
	unmarshalNullable(custom, &src.CustomResponse)
	src.URL = strings.TrimRight(IngestBaseURL, "/") + "/" + src.Key

	return &src, nil
}

// Custom responses replace the default acknowledgement returned to senders.
const maxCustomResponseBody = 1000

var customResponseTypes = map[string]bool{"application/json": true, "text/plain": true, "application/xml": true}

// normalizeCustomResponse validates a custom response; an empty body means "off" (nil).
func normalizeCustomResponse(c *models.CustomResponse) (*models.CustomResponse, error) {
	if c == nil || strings.TrimSpace(c.Body) == "" {
		return nil, nil
	}

	if c.ContentType == "" {
		c.ContentType = "application/json"
	}

	if !customResponseTypes[c.ContentType] {
		return nil, apierr.BadRequest("custom_response.content_type must be application/json, text/plain or application/xml")
	}

	if len(c.Body) > maxCustomResponseBody {
		return nil, apierr.BadRequest("custom_response.body must be at most %d characters", maxCustomResponseBody)
	}

	if c.ContentType == "application/json" && !json.Valid([]byte(c.Body)) {
		return nil, apierr.BadRequest("custom_response.body must be valid JSON for application/json")
	}

	return c, nil
}

func normalizeMethods(m []string) string {
	if len(m) == 0 {
		return "POST,PUT,PATCH,DELETE,GET"
	}

	out := make([]string, 0, len(m))
	for _, x := range m {
		out = append(out, strings.ToUpper(strings.TrimSpace(x)))
	}

	return strings.Join(out, ",")
}

func (s *Store) CreateSource(ctx context.Context, in *models.SourceInput) (*models.Source, error) {
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		return nil, apierr.BadRequest("name is required")
	}

	typeID := sourcetypes.Webhook
	if in.Type != nil && *in.Type != "" {
		typeID = strings.ToUpper(*in.Type)
	}

	st, ok := sourcetypes.Get(typeID)
	if !ok {
		return nil, apierr.BadRequest("unknown source type %q", typeID)
	}

	methods := in.AllowedMethods
	if len(methods) == 0 {
		methods = st.Methods
	}

	cfg := cleanConfig(st, nil, in.Config)
	if typeID == sourcetypes.PublishAPI && cfg["api_key"] == "" {
		cfg["api_key"] = "ewk_" + ids.Random(32)
	}

	verif := in.Verification
	if !st.CustomAuth {
		verif = nil // providers verify with their own scheme
	}

	custom, err := normalizeCustomResponse(in.CustomResponse)
	if err != nil {
		return nil, err
	}

	row := s.db.QueryRowContext(ctx, `INSERT INTO sources (id, name, key, description, allowed_methods, verification, custom_response, workspace_id, type, config)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10::jsonb) RETURNING `+sourceCols,
		ids.New(ids.Source), strings.TrimSpace(*in.Name), ids.SourceKey(), in.Description,
		normalizeMethods(methods), jsonParam(verif), jsonParam(custom), s.ws, st.ID, jsonParam(cfg))

	src, err := scanSource(row)
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("a source named %q already exists", *in.Name)
	}

	return src, err
}

// UpsertSourceByName returns the existing source with this name, or creates it.
func (s *Store) UpsertSourceByName(ctx context.Context, in *models.SourceInput) (*models.Source, error) {
	if in.Name == nil {
		return nil, apierr.BadRequest("source.name is required")
	}

	src, err := scanSource(s.db.QueryRowContext(ctx, `SELECT `+sourceCols+` FROM sources WHERE name=$1`+wsCond(2, "workspace_id"), *in.Name, s.ws))
	if err == nil {
		return src, nil
	}

	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	return s.CreateSource(ctx, in)
}

// cleanConfig keeps only the type's own fields, overlaying updates on the current values.
// Server-generated fields (the Publish API key) can't be set by clients.
func cleanConfig(t *sourcetypes.Type, cur, upd map[string]string) map[string]string {
	out := map[string]string{}

	for _, f := range t.Fields {
		if v, ok := cur[f.Key]; ok {
			out[f.Key] = v
		}

		if v, ok := upd[f.Key]; ok && !f.Generated {
			out[f.Key] = strings.TrimSpace(v)
		}
	}

	return out
}

// RotateSourceKey issues a new Publish API key.
func (s *Store) RotateSourceKey(ctx context.Context, id string) (*models.Source, error) {
	src, err := s.GetSource(ctx, id)
	if err != nil {
		return nil, err
	}

	if src.Type != sourcetypes.PublishAPI {
		return nil, apierr.BadRequest("only Publish API sources have an API key")
	}

	src.Config["api_key"] = "ewk_" + ids.Random(32)

	return scanSource(s.db.QueryRowContext(ctx, `UPDATE sources SET config=$2::jsonb, updated_at=now() WHERE id=$1`+wsCond(3, "workspace_id")+
		` RETURNING `+sourceCols, id, jsonParam(src.Config), s.ws))
}

func (s *Store) GetSource(ctx context.Context, id string) (*models.Source, error) {
	return scanSource(s.db.QueryRowContext(ctx, `SELECT `+sourceCols+` FROM sources WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws))
}

func (s *Store) GetSourceByKey(ctx context.Context, key string) (*models.Source, error) {
	return scanSource(s.db.QueryRowContext(ctx, `SELECT `+sourceCols+` FROM sources WHERE key=$1`, key))
}

func (s *Store) ListSources(ctx context.Context, name, status string, p ListParams) (*models.Page[models.Source], error) {
	var w where

	s.scope(&w, "workspace_id")

	if name != "" {
		w.add("(name ILIKE ? OR id = ?)", "%"+name+"%", name)
	}

	switch status {
	case "active":
		w.add("disabled_at IS NULL")
	case "disabled":
		w.add("disabled_at IS NOT NULL")
	}

	w.cursor("created_at", p.Cursor)

	rows, err := s.db.QueryContext(ctx, `SELECT `+sourceCols+` FROM sources`+w.sql()+
		` ORDER BY created_at DESC, id DESC LIMIT `+w.next(), append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Source]{Models: []models.Source{}}

	for rows.Next() {
		src, err := scanSource(rows)
		if err != nil {
			return nil, err
		}

		page.Models = append(page.Models, *src)
	}

	return paginate(page, p.limit(), func(x models.Source) (time.Time, string) { return x.CreatedAt, x.ID }), rows.Err()
}

func (s *Store) UpdateSource(ctx context.Context, id string, in *models.SourceInput) (*models.Source, error) {
	cur, err := s.GetSource(ctx, id)
	if err != nil {
		return nil, err
	}

	name, desc := cur.Name, cur.Description
	methods, verif, custom := cur.AllowedMethods, cur.Verification, cur.CustomResponse

	if in.Name != nil {
		name = *in.Name
	}

	if in.Description != nil {
		desc = in.Description
	}

	if in.AllowedMethods != nil {
		methods = in.AllowedMethods
	}

	if in.Verification != nil {
		verif = in.Verification
		if verif.Type == "" {
			verif = nil // {"verification": {}} clears it
		}
	}

	if in.CustomResponse != nil {
		if custom, err = normalizeCustomResponse(in.CustomResponse); err != nil {
			return nil, err
		}
	}

	cfg := cur.Config
	if st, ok := sourcetypes.Get(cur.Type); ok {
		cfg = cleanConfig(st, cur.Config, in.Config)
		if !st.CustomAuth {
			verif = nil
		}
	}

	src, err := scanSource(s.db.QueryRowContext(ctx, `UPDATE sources SET name=$2, description=$3, allowed_methods=$4,
		verification=$5::jsonb, custom_response=$6::jsonb, config=$8::jsonb, updated_at=now() WHERE id=$1`+wsCond(7, "workspace_id")+` RETURNING `+sourceCols,
		id, name, desc, normalizeMethods(methods), jsonParam(verif), jsonParam(custom), s.ws, jsonParam(cfg)))
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("a source named %q already exists", name)
	}

	return src, err
}

func (s *Store) SetSourceDisabled(ctx context.Context, id string, disabled bool) (*models.Source, error) {
	q := `UPDATE sources SET disabled_at=NULL, updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id") + ` RETURNING ` + sourceCols
	if disabled {
		q = `UPDATE sources SET disabled_at=now(), updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id") + ` RETURNING ` + sourceCols
	}

	return scanSource(s.db.QueryRowContext(ctx, q, id, s.ws))
}

func (s *Store) DeleteSource(ctx context.Context, id string) error {
	return execOne(ctx, s.db, `DELETE FROM sources WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws)
}

func execOne(ctx context.Context, db DB, q string, args ...any) error {
	res, err := db.ExecContext(ctx, q, args...)
	if err != nil {
		return err
	}

	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}

	return nil
}

// paginate trims the extra row fetched to detect a next page and sets the cursor.
func paginate[T any](p *models.Page[T], limit int, key func(T) (time.Time, string)) *models.Page[T] {
	if len(p.Models) > limit {
		p.Models = p.Models[:limit]
		last := p.Models[limit-1]
		t, id := key(last)
		p.NextCursor = encodeCursor(t, id)
	}

	p.Count = len(p.Models)

	return p
}
