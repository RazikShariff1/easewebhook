package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
)

const destCols = `id, name, description, url, http_method, auth_type, auth, rate_limit, rate_limit_period, path_forwarding, disabled_at, created_at, updated_at, type`

func scanDestination(s scanner) (*models.Destination, error) {
	var (
		d    models.Destination
		auth []byte
	)

	if err := s.Scan(&d.ID, &d.Name, &d.Description, &d.URL, &d.HTTPMethod, &d.AuthType, &auth, &d.RateLimit,
		&d.RateLimitPeriod, &d.PathForwarding, &d.DisabledAt, &d.CreatedAt, &d.UpdatedAt, &d.Type); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	if len(auth) > 0 {
		d.Auth = json.RawMessage(auth)
	}

	return &d, nil
}

var validAuthTypes = map[string]bool{
	models.AuthNone: true, models.AuthBearer: true, models.AuthBasic: true,
	models.AuthAPIKey: true, models.AuthSignature: true,
}

var validPeriods = map[string]bool{"second": true, "minute": true, "hour": true}

// MockDestinationURL is where MOCK_API destinations deliver (the built-in /mock endpoint).
var MockDestinationURL = "http://localhost:8000/mock"

func validateDestination(d *models.Destination) error {
	if strings.TrimSpace(d.Name) == "" {
		return apierr.BadRequest("name is required")
	}

	switch d.Type {
	case models.DestHTTP:
	case models.DestMockAPI:
		d.URL = MockDestinationURL // fixed: users don't pick the URL
	case models.DestCLI:
		return apierr.BadRequest("CLI destinations aren't available yet; use HTTP (with a tunnel) or Mock API")
	default:
		return apierr.BadRequest("type must be HTTP, MOCK_API or CLI")
	}

	u, err := url.Parse(d.URL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return apierr.BadRequest("url must be an absolute http(s) URL")
	}

	if !validAuthTypes[d.AuthType] {
		return apierr.BadRequest("auth_type must be one of NONE, BEARER_TOKEN, BASIC_AUTH, API_KEY, EASE_SIGNATURE")
	}

	if !validPeriods[d.RateLimitPeriod] {
		return apierr.BadRequest("rate_limit_period must be second, minute or hour")
	}

	if d.HTTPMethod != nil {
		m := strings.ToUpper(*d.HTTPMethod)
		switch m {
		case "GET", "POST", "PUT", "PATCH", "DELETE":
			d.HTTPMethod = &m
		case "":
			d.HTTPMethod = nil
		default:
			return apierr.BadRequest("http_method must be GET, POST, PUT, PATCH or DELETE")
		}
	}

	return nil
}

func applyDestinationInput(d *models.Destination, in *models.DestinationInput) {
	if in.Type != nil && *in.Type != "" {
		d.Type = strings.ToUpper(*in.Type)
	}

	if in.Name != nil {
		d.Name = strings.TrimSpace(*in.Name)
	}

	if in.Description != nil {
		d.Description = in.Description
	}

	if in.URL != nil {
		d.URL = strings.TrimSpace(*in.URL)
	}

	if in.HTTPMethod != nil {
		d.HTTPMethod = in.HTTPMethod
	}

	if in.AuthType != nil {
		d.AuthType = strings.ToUpper(*in.AuthType)
	}

	if in.Auth != nil {
		d.Auth = in.Auth
	}

	if in.RateLimit != nil {
		if *in.RateLimit <= 0 {
			d.RateLimit = nil
		} else {
			d.RateLimit = in.RateLimit
		}
	}

	if in.RateLimitPeriod != nil {
		d.RateLimitPeriod = *in.RateLimitPeriod
	}

	if in.PathForwarding != nil {
		d.PathForwarding = *in.PathForwarding
	}
}

func (s *Store) CreateDestination(ctx context.Context, in *models.DestinationInput) (*models.Destination, error) {
	d := &models.Destination{Type: models.DestHTTP, AuthType: models.AuthNone, RateLimitPeriod: "second", PathForwarding: true}
	applyDestinationInput(d, in)

	if err := validateDestination(d); err != nil {
		return nil, err
	}

	out, err := scanDestination(s.db.QueryRowContext(ctx, `INSERT INTO destinations
		(id, name, description, url, http_method, auth_type, auth, rate_limit, rate_limit_period, path_forwarding, workspace_id, type)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12) RETURNING `+destCols,
		ids.New(ids.Destination), d.Name, d.Description, d.URL, d.HTTPMethod, d.AuthType, jsonParam(d.Auth),
		d.RateLimit, d.RateLimitPeriod, d.PathForwarding, s.ws, d.Type))
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("a destination named %q already exists", d.Name)
	}

	return out, err
}

func (s *Store) UpsertDestinationByName(ctx context.Context, in *models.DestinationInput) (*models.Destination, error) {
	if in.Name == nil {
		return nil, apierr.BadRequest("destination.name is required")
	}

	d, err := scanDestination(s.db.QueryRowContext(ctx, `SELECT `+destCols+` FROM destinations WHERE name=$1`+wsCond(2, "workspace_id"), *in.Name, s.ws))
	if err == nil {
		return d, nil
	}

	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	return s.CreateDestination(ctx, in)
}

func (s *Store) GetDestination(ctx context.Context, id string) (*models.Destination, error) {
	return scanDestination(s.db.QueryRowContext(ctx, `SELECT `+destCols+` FROM destinations WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws))
}

func (s *Store) ListDestinations(ctx context.Context, name, status string, p ListParams) (*models.Page[models.Destination], error) {
	var w where

	s.scope(&w, "workspace_id")

	if name != "" {
		w.add("(name ILIKE ? OR id = ? OR url ILIKE ?)", "%"+name+"%", name, "%"+name+"%")
	}

	switch status {
	case "active":
		w.add("disabled_at IS NULL")
	case "disabled":
		w.add("disabled_at IS NOT NULL")
	}

	w.cursor("created_at", p.Cursor)

	rows, err := s.db.QueryContext(ctx, `SELECT `+destCols+` FROM destinations`+w.sql()+
		` ORDER BY created_at DESC, id DESC LIMIT `+w.next(), append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Destination]{Models: []models.Destination{}}

	for rows.Next() {
		d, err := scanDestination(rows)
		if err != nil {
			return nil, err
		}

		page.Models = append(page.Models, *d)
	}

	return paginate(page, p.limit(), func(x models.Destination) (time.Time, string) { return x.CreatedAt, x.ID }), rows.Err()
}

func (s *Store) UpdateDestination(ctx context.Context, id string, in *models.DestinationInput) (*models.Destination, error) {
	d, err := s.GetDestination(ctx, id)
	if err != nil {
		return nil, err
	}

	applyDestinationInput(d, in)

	if err := validateDestination(d); err != nil {
		return nil, err
	}

	out, err := scanDestination(s.db.QueryRowContext(ctx, `UPDATE destinations SET name=$2, description=$3, url=$4,
		http_method=$5, auth_type=$6, auth=$7::jsonb, rate_limit=$8, rate_limit_period=$9, path_forwarding=$10,
		type=$12, updated_at=now() WHERE id=$1`+wsCond(11, "workspace_id")+` RETURNING `+destCols,
		id, d.Name, d.Description, d.URL, d.HTTPMethod, d.AuthType, jsonParam(d.Auth), d.RateLimit,
		d.RateLimitPeriod, d.PathForwarding, s.ws, d.Type))
	if isUniqueViolation(err) {
		return nil, apierr.Conflict("a destination named %q already exists", d.Name)
	}

	return out, err
}

func (s *Store) SetDestinationDisabled(ctx context.Context, id string, disabled bool) (*models.Destination, error) {
	q := `UPDATE destinations SET disabled_at=NULL, updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id") + ` RETURNING ` + destCols
	if disabled {
		q = `UPDATE destinations SET disabled_at=now(), updated_at=now() WHERE id=$1` + wsCond(2, "workspace_id") + ` RETURNING ` + destCols
	}

	return scanDestination(s.db.QueryRowContext(ctx, q, id, s.ws))
}

func (s *Store) DeleteDestination(ctx context.Context, id string) error {
	return execOne(ctx, s.db, `DELETE FROM destinations WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws)
}
