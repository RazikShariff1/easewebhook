// Package ingest receives webhooks on /e/{source_key} and fans them out into events per connection.
package ingest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/zopping/easewebhook/backend/internal/filter"
	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
	"github.com/zopping/easewebhook/backend/internal/store"
	"github.com/zopping/easewebhook/backend/internal/transform"
)

var errFiltered = errors.New("filtered")

// Prepared is a request after a connection's rules ran.
type Prepared struct {
	Request *transform.Request
	Delay   time.Duration
	Logs    []string
}

// ApplyRules runs a connection's rules (in order) against an incoming request.
// Returns errFiltered if a filter rejects it.
func ApplyRules(ctx context.Context, st *store.Store, conn *models.Connection, in *transform.Request) (*Prepared, error) {
	cur := cloneRequest(in)
	out := &Prepared{Request: cur}

	for _, r := range conn.Rules {
		switch r.Type {
		case "filter":
			ok, err := matchFilter(r, cur)
			if err != nil {
				return nil, err
			}

			if !ok {
				return nil, errFiltered
			}
		case "transform":
			t, err := st.GetTransformation(ctx, r.TransformationID)
			if err != nil {
				return nil, fmt.Errorf("loading transformation %s: %w", r.TransformationID, err)
			}

			res, err := transform.Run(t.Code, t.Env, cur, map[string]any{
				"connection": map[string]any{"id": conn.ID, "name": conn.Name, "source_id": conn.SourceID, "destination_id": conn.DestinationID},
			})
			if res != nil {
				out.Logs = append(out.Logs, res.Logs...)
			}

			if err != nil {
				return nil, fmt.Errorf("transformation %s: %w", t.Name, err)
			}

			cur = res.Request
			out.Request = cur
		case "delay":
			out.Delay = time.Duration(r.Delay) * time.Millisecond
		}
	}

	return out, nil
}

func matchFilter(r models.Rule, req *transform.Request) (bool, error) {
	headers := map[string]any{}
	for k, v := range req.Headers {
		headers[k] = v
	}

	query := map[string]any{}

	if q, err := url.ParseQuery(req.Query); err == nil {
		for k, v := range q {
			if len(v) == 1 {
				query[k] = v[0]
			} else {
				arr := make([]any, len(v))
				for i := range v {
					arr[i] = v[i]
				}

				query[k] = arr
			}
		}
	}

	checks := []struct {
		f  json.RawMessage
		in any
	}{
		{r.Body, req.Body},
		{r.Headers, headers},
		{r.Query, query},
		{r.Path, req.Path},
	}

	for _, c := range checks {
		ok, err := filter.Match(c.f, c.in)
		if err != nil || !ok {
			return false, err
		}
	}

	return true, nil
}

func cloneRequest(r *transform.Request) *transform.Request {
	b, _ := json.Marshal(r)

	var out transform.Request

	_ = json.Unmarshal(b, &out)

	if out.Headers == nil {
		out.Headers = map[string]string{}
	}

	return &out
}

// BodyString serializes a request body for storage/delivery.
func BodyString(body any) string {
	switch v := body.(type) {
	case nil:
		return ""
	case string:
		return v
	default:
		b, _ := json.Marshal(v)
		return string(b)
	}
}

// ParseBody turns a raw payload into a JSON value when possible, else keeps the string.
func ParseBody(raw string) any {
	if raw == "" {
		return nil
	}

	var v any
	if json.Unmarshal([]byte(raw), &v) == nil {
		return v
	}

	return raw
}

// FanOut creates one event per active connection. Returns (events created, ignored).
func FanOut(ctx context.Context, st *store.Store, log Logger, req *store.NewRequest) (int, int, error) {
	conns, err := st.ActiveConnectionsForSource(ctx, req.SourceID)
	if err != nil {
		return 0, 0, err
	}

	in := &transform.Request{
		Method: req.Method, Path: req.Path, Query: req.Query, Headers: req.Headers, Body: ParseBody(req.Body),
	}

	created, ignored := 0, 0

	for i := range conns {
		c := &conns[i]

		p, err := ApplyRules(ctx, st, c, in)
		if err != nil {
			ignored++

			if !errors.Is(err, errFiltered) {
				log.Errorf("request %s connection %s: %v", req.ID, c.ID, err)
			}

			continue
		}

		status := models.EventQueued
		next := time.Now().Add(p.Delay)

		if p.Delay > 0 {
			status = models.EventScheduled
		}

		if c.PausedAt != nil {
			status = models.EventHold
		}

		ev := &store.NewEvent{
			ID: ids.New(ids.Event), WorkspaceID: req.WorkspaceID, RequestID: req.ID, ConnectionID: c.ID, SourceID: c.SourceID,
			DestinationID: c.DestinationID, Status: status, Method: p.Request.Method, Path: p.Request.Path,
			Query: p.Request.Query, Headers: p.Request.Headers, Body: BodyString(p.Request.Body), NextAttemptAt: &next,
		}

		if err := st.InsertEvent(ctx, ev); err != nil {
			return created, ignored, err
		}

		created++
	}

	return created, ignored, st.SetRequestCounts(ctx, req.ID, created, ignored)
}

type Logger interface {
	Errorf(format string, args ...any)
	Infof(format string, args ...any)
}
