package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
)

const trsCols = `id, name, code, env, created_at, updated_at`

func scanTransformation(s scanner) (*models.Transformation, error) {
	var (
		t   models.Transformation
		env []byte
	)

	if err := s.Scan(&t.ID, &t.Name, &t.Code, &env, &t.CreatedAt, &t.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	unmarshalNullable(env, &t.Env)

	if t.Env == nil {
		t.Env = map[string]string{}
	}

	return &t, nil
}

func (s *Store) CreateTransformation(ctx context.Context, in *models.TransformationInput) (*models.Transformation, error) {
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" {
		return nil, apierr.BadRequest("name is required")
	}

	if in.Code == nil || strings.TrimSpace(*in.Code) == "" {
		return nil, apierr.BadRequest("code is required")
	}

	env := in.Env
	if env == nil {
		env = map[string]string{}
	}

	t, err := scanTransformation(s.db.QueryRowContext(ctx, `INSERT INTO transformations (id, name, code, env, workspace_id)
		VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING `+trsCols, ids.New(ids.Transformation), strings.TrimSpace(*in.Name), *in.Code, jsonParam(env), s.ws))
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("a transformation named %q already exists", *in.Name)
	}

	return t, err
}

func (s *Store) GetTransformation(ctx context.Context, id string) (*models.Transformation, error) {
	return scanTransformation(s.db.QueryRowContext(ctx, `SELECT `+trsCols+` FROM transformations WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws))
}

func (s *Store) ListTransformations(ctx context.Context, name string, p ListParams) (*models.Page[models.Transformation], error) {
	var w where

	s.scope(&w, "workspace_id")

	if name != "" {
		w.add("name ILIKE ?", "%"+name+"%")
	}

	w.cursor("created_at", p.Cursor)

	rows, err := s.db.QueryContext(ctx, `SELECT `+trsCols+` FROM transformations`+w.sql()+
		` ORDER BY created_at DESC, id DESC LIMIT `+w.next(), append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Transformation]{Models: []models.Transformation{}}

	for rows.Next() {
		t, err := scanTransformation(rows)
		if err != nil {
			return nil, err
		}

		page.Models = append(page.Models, *t)
	}

	return paginate(page, p.limit(), func(x models.Transformation) (time.Time, string) { return x.CreatedAt, x.ID }), rows.Err()
}

func (s *Store) UpdateTransformation(ctx context.Context, id string, in *models.TransformationInput) (*models.Transformation, error) {
	t, err := s.GetTransformation(ctx, id)
	if err != nil {
		return nil, err
	}

	if in.Name != nil {
		t.Name = strings.TrimSpace(*in.Name)
	}

	if in.Code != nil {
		t.Code = *in.Code
	}

	if in.Env != nil {
		t.Env = in.Env
	}

	out, err := scanTransformation(s.db.QueryRowContext(ctx, `UPDATE transformations SET name=$2, code=$3, env=$4::jsonb,
		updated_at=now() WHERE id=$1`+wsCond(5, "workspace_id")+` RETURNING `+trsCols, id, t.Name, t.Code, jsonParam(t.Env), s.ws))
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("a transformation named %q already exists", t.Name)
	}

	return out, err
}

func (s *Store) DeleteTransformation(ctx context.Context, id string) error {
	var n int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM connections, jsonb_array_elements(rules) r
		WHERE r->>'transformation_id' = $1`, id).Scan(&n); err != nil {
		return err
	}

	if n > 0 {
		return apierr.Conflict("transformation is used by %d connection(s); remove it from their rules first", n)
	}

	return execOne(ctx, s.db, `DELETE FROM transformations WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws)
}
