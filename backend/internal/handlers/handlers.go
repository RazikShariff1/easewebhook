// Package handlers exposes the management REST API on top of the store.
package handlers

import (
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"gofr.dev/pkg/gofr"

	"github.com/zopping/easewebhook/backend/internal/apierr"
	"github.com/zopping/easewebhook/backend/internal/auth"
	"github.com/zopping/easewebhook/backend/internal/ingest"
	"github.com/zopping/easewebhook/backend/internal/models"
	"github.com/zopping/easewebhook/backend/internal/sourcetypes"
	"github.com/zopping/easewebhook/backend/internal/store"
	"github.com/zopping/easewebhook/backend/internal/transform"
)

type API struct {
	// Log is used by request retries (fan-out runs outside a GoFr request scope).
	Log ingest.Logger

	// Notify wakes the delivery worker after a retry is queued.
	Notify func()
}

// noWorkspace never matches a row, so a missing workspace can't fall back to the unscoped store.
const noWorkspace = "__none__"

// st returns the store scoped to the request's workspace (set by the auth middleware).
// pool is the tuned database pool the store uses (see store.OpenPool); nil falls back to GoFr's connection.
var pool store.DB

// UseDB makes every handler query go through db instead of GoFr's default connection.
func UseDB(db store.DB) { pool = db }

func dbFor(c *gofr.Context) store.DB {
	if pool != nil {
		return pool
	}

	return c.SQL
}

func st(c *gofr.Context) *store.Store {
	ws := auth.WorkspaceID(c)
	if ws == "" {
		ws = noWorkspace
	}

	return store.New(dbFor(c)).In(ws)
}

func mapErr(err error, entity, id string) error {
	if errors.Is(err, store.ErrNotFound) {
		return apierr.NotFound(entity, id)
	}

	return err
}

func listParams(c *gofr.Context) store.ListParams {
	limit, _ := strconv.Atoi(c.Param("limit"))
	return store.ListParams{Limit: limit, Cursor: c.Param("next")}
}

func parseTime(c *gofr.Context, key string) (*time.Time, error) {
	v := c.Param(key)
	if v == "" {
		return nil, nil
	}

	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return nil, apierr.BadRequest("%s must be an RFC3339 timestamp", key)
	}

	return &t, nil
}

func rawJSONParam(c *gofr.Context, key string) (json.RawMessage, error) {
	v := c.Param(key)
	if v == "" {
		return nil, nil
	}

	if !json.Valid([]byte(v)) {
		return nil, apierr.BadRequest("%s must be valid JSON", key)
	}

	return json.RawMessage(v), nil
}

func bind(c *gofr.Context, v any) error {
	if err := c.Bind(v); err != nil {
		return apierr.BadRequest("invalid JSON body: %v", err)
	}

	return nil
}

// Register wires all management routes.
func (a *API) Register(app *gofr.App) {
	a.registerWorkspaces(app)

	// Sources
	app.GET("/sources", a.listSources)
	app.POST("/sources", a.createSource)
	app.GET("/sources/{id}", a.getSource)
	app.PUT("/sources/{id}", a.updateSource)
	app.DELETE("/sources/{id}", a.deleteSource)
	app.PUT("/sources/{id}/disable", a.setSourceDisabled(true))
	app.PUT("/sources/{id}/enable", a.setSourceDisabled(false))
	app.POST("/sources/{id}/rotate-key", a.rotateSourceKey)
	app.GET("/sources/{id}/stats", a.sourceStats)
	app.GET("/sources/{id}/histogram", a.sourceHistogram)
	app.GET("/source-types", func(*gofr.Context) (any, error) { return sourcetypes.All(), nil })

	// Destinations
	app.GET("/destinations", a.listDestinations)
	app.POST("/destinations", a.createDestination)
	app.GET("/destinations/{id}", a.getDestination)
	app.PUT("/destinations/{id}", a.updateDestination)
	app.DELETE("/destinations/{id}", a.deleteDestination)
	app.PUT("/destinations/{id}/disable", a.setDestinationDisabled(true))
	app.PUT("/destinations/{id}/enable", a.setDestinationDisabled(false))
	app.GET("/destinations/{id}/stats", a.destinationStats)

	// Transformations
	app.GET("/transformations", a.listTransformations)
	app.POST("/transformations", a.createTransformation)
	app.POST("/transformations/run", a.runTransformation)
	app.GET("/transformations/{id}", a.getTransformation)
	app.PUT("/transformations/{id}", a.updateTransformation)
	app.DELETE("/transformations/{id}", a.deleteTransformation)

	// Connections
	app.GET("/connections", a.listConnections)
	app.POST("/connections", a.createConnection)
	app.GET("/connections/{id}", a.getConnection)
	app.PUT("/connections/{id}", a.updateConnection)
	app.DELETE("/connections/{id}", a.deleteConnection)
	app.PUT("/connections/{id}/pause", a.setConnectionPaused(true))
	app.PUT("/connections/{id}/unpause", a.setConnectionPaused(false))
	app.PUT("/connections/{id}/disable", a.setConnectionDisabled(true))
	app.PUT("/connections/{id}/enable", a.setConnectionDisabled(false))

	// Requests
	app.GET("/requests", a.listRequests)
	// literal paths before /requests/{id}: the router matches in registration order
	app.GET("/requests/histogram", a.requestHistogram)
	app.GET("/requests/{id}", a.getRequest)
	app.GET("/requests/{id}/events", a.listRequestEvents)
	app.POST("/requests/{id}/retry", a.retryRequest)
	app.POST("/bulk/requests/retry", a.bulkRetryRequests)

	// Events
	app.GET("/events", a.listEvents)
	app.GET("/events/histogram", a.eventHistogram)
	app.GET("/events/{id}", a.getEvent)
	app.GET("/events/{id}/attempts", a.listEventAttempts)
	app.POST("/events/{id}/retry", a.retryEvent)
	app.POST("/events/{id}/cancel", a.cancelEvent)
	app.POST("/bulk/events/retry", a.bulkRetry)
	app.POST("/bulk/events/cancel", a.bulkCancel)

	// Attempts
	app.GET("/attempts", a.listAttempts)
	app.GET("/attempts/{id}", a.getAttempt)

	// Dashboard stats (24h counters shown on list pages)
	app.GET("/stats", a.stats)
	app.GET("/public/stats", func(c *gofr.Context) (any, error) { return store.New(dbFor(c)).PublicStats(c) })
}

// ---------------- Sources ----------------

func (a *API) listSources(c *gofr.Context) (any, error) {
	return st(c).ListSources(c, c.Param("name"), c.Param("status"), listParams(c))
}

func (a *API) createSource(c *gofr.Context) (any, error) {
	var in models.SourceInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	return st(c).CreateSource(c, &in)
}

func (a *API) getSource(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	s, err := st(c).GetSource(c, id)

	return s, mapErr(err, "source", id)
}

func (a *API) updateSource(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	var in models.SourceInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	s, err := st(c).UpdateSource(c, id, &in)

	return s, mapErr(err, "source", id)
}

// rangeParams reads ?from&to (RFC3339), defaulting to the last 24 hours.
func rangeParams(c *gofr.Context) (time.Time, time.Time, error) {
	from, err := parseTime(c, "from")
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	to, err := parseTime(c, "to")
	if err != nil {
		return time.Time{}, time.Time{}, err
	}

	end := time.Now().UTC()
	if to != nil {
		end = *to
	}

	start := end.Add(-24 * time.Hour)
	if from != nil {
		start = *from
	}

	if !start.Before(end) {
		return time.Time{}, time.Time{}, apierr.BadRequest("from must be before to")
	}

	return start, end, nil
}

func (a *API) sourceStats(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	if _, err := st(c).GetSource(c, id); err != nil {
		return nil, mapErr(err, "source", id)
	}

	from, to, err := rangeParams(c)
	if err != nil {
		return nil, err
	}

	return st(c).SourceStats(c, id, from, to)
}

// sourceHistogram: requests per bucket by status, for the source's metrics chart (?buckets=N, default 60).
func (a *API) sourceHistogram(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	if _, err := st(c).GetSource(c, id); err != nil {
		return nil, mapErr(err, "source", id)
	}

	from, to, err := rangeParams(c)
	if err != nil {
		return nil, err
	}

	n, _ := strconv.Atoi(c.Param("buckets"))
	if n <= 0 || n > 500 {
		n = 60
	}

	bucket := max(to.Sub(from)/time.Duration(n), time.Second).Truncate(time.Second)

	buckets, err := st(c).RequestHistogram(c, store.RequestFilter{SourceID: id}, from.Truncate(bucket), to, bucket)
	if err != nil {
		return nil, err
	}

	return map[string]any{"bucket_seconds": int(bucket.Seconds()), "buckets": buckets}, nil
}

func (a *API) rotateSourceKey(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	s, err := st(c).RotateSourceKey(c, id)

	return s, mapErr(err, "source", id)
}

func (a *API) deleteSource(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	return nil, mapErr(st(c).DeleteSource(c, id), "source", id)
}

func (a *API) setSourceDisabled(disabled bool) gofr.Handler {
	return func(c *gofr.Context) (any, error) {
		id := c.PathParam("id")
		s, err := st(c).SetSourceDisabled(c, id, disabled)

		return s, mapErr(err, "source", id)
	}
}

// ---------------- Destinations ----------------

func (a *API) listDestinations(c *gofr.Context) (any, error) {
	return st(c).ListDestinations(c, c.Param("name"), c.Param("status"), listParams(c))
}

func (a *API) createDestination(c *gofr.Context) (any, error) {
	var in models.DestinationInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	return st(c).CreateDestination(c, &in)
}

func (a *API) getDestination(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	d, err := st(c).GetDestination(c, id)

	return d, mapErr(err, "destination", id)
}

func (a *API) updateDestination(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	var in models.DestinationInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	d, err := st(c).UpdateDestination(c, id, &in)

	return d, mapErr(err, "destination", id)
}

// destinationStats: ?from&to (RFC3339, default last 24h) bound the response breakdown; pending counts are live.
func (a *API) destinationStats(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	if _, err := st(c).GetDestination(c, id); err != nil {
		return nil, mapErr(err, "destination", id)
	}

	from, err := parseTime(c, "from")
	if err != nil {
		return nil, err
	}

	to, err := parseTime(c, "to")
	if err != nil {
		return nil, err
	}

	end := time.Now().UTC()
	if to != nil {
		end = *to
	}

	start := end.Add(-24 * time.Hour)
	if from != nil {
		start = *from
	}

	return st(c).DestinationStats(c, id, start, end)
}

func (a *API) deleteDestination(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	return nil, mapErr(st(c).DeleteDestination(c, id), "destination", id)
}

func (a *API) setDestinationDisabled(disabled bool) gofr.Handler {
	return func(c *gofr.Context) (any, error) {
		id := c.PathParam("id")

		d, err := st(c).SetDestinationDisabled(c, id, disabled)
		if err != nil {
			return nil, mapErr(err, "destination", id)
		}

		if !disabled {
			if err := st(c).ReleaseHeldForDestination(c, id); err != nil {
				return nil, err
			}

			a.notify()
		}

		return d, nil
	}
}

// ---------------- Transformations ----------------

func (a *API) listTransformations(c *gofr.Context) (any, error) {
	return st(c).ListTransformations(c, c.Param("name"), listParams(c))
}

func (a *API) createTransformation(c *gofr.Context) (any, error) {
	var in models.TransformationInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	if in.Code != nil {
		if err := checkCompiles(*in.Code, in.Env); err != nil {
			return nil, err
		}
	}

	return st(c).CreateTransformation(c, &in)
}

func (a *API) getTransformation(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	t, err := st(c).GetTransformation(c, id)

	return t, mapErr(err, "transformation", id)
}

func (a *API) updateTransformation(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	var in models.TransformationInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	if in.Code != nil {
		if err := checkCompiles(*in.Code, in.Env); err != nil {
			return nil, err
		}
	}

	t, err := st(c).UpdateTransformation(c, id, &in)

	return t, mapErr(err, "transformation", id)
}

func (a *API) deleteTransformation(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	return nil, mapErr(st(c).DeleteTransformation(c, id), "transformation", id)
}

// checkCompiles runs the code against an empty request to catch syntax errors early.
func checkCompiles(code string, env map[string]string) error {
	_, err := transform.Run(code, env, &transform.Request{Method: "POST", Headers: map[string]string{}, Body: map[string]any{}}, map[string]any{})
	if err != nil {
		return apierr.BadRequest("transformation code error: %v", err)
	}

	return nil
}

type runTransformationInput struct {
	Code             string            `json:"code"`
	TransformationID string            `json:"transformation_id"`
	Env              map[string]string `json:"env"`
	Request          transform.Request `json:"request"`
	// Or test against a stored request/event payload.
	RequestID string `json:"request_id"`
	EventID   string `json:"event_id"`
}

// runTransformation tests code against a sample request without saving anything.
func (a *API) runTransformation(c *gofr.Context) (any, error) {
	var in runTransformationInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	s := st(c)

	if in.TransformationID != "" && in.Code == "" {
		t, err := s.GetTransformation(c, in.TransformationID)
		if err != nil {
			return nil, mapErr(err, "transformation", in.TransformationID)
		}

		in.Code = t.Code

		if in.Env == nil {
			in.Env = t.Env
		}
	}

	if in.Code == "" {
		return nil, apierr.BadRequest("code or transformation_id is required")
	}

	req := &in.Request

	switch {
	case in.RequestID != "":
		r, err := s.GetRequest(c, in.RequestID)
		if err != nil {
			return nil, mapErr(err, "request", in.RequestID)
		}

		req = &transform.Request{Method: r.Method, Path: r.Path, Query: r.Query, Headers: r.Headers, Body: r.Body}
	case in.EventID != "":
		e, err := s.GetEvent(c, in.EventID)
		if err != nil {
			return nil, mapErr(err, "event", in.EventID)
		}

		req = &transform.Request{Method: e.Method, Path: e.Path, Query: e.Query, Headers: e.Headers, Body: e.Body}
	}

	if req.Method == "" {
		req.Method = "POST"
	}

	if req.Headers == nil {
		req.Headers = map[string]string{}
	}

	res, err := transform.Run(in.Code, in.Env, req, map[string]any{})

	out := map[string]any{"request": nil, "console": []string{}, "error": nil}
	if res != nil {
		out["request"] = res.Request
		if res.Logs != nil {
			out["console"] = res.Logs
		}
	}

	if err != nil {
		out["error"] = err.Error()
	}

	return out, nil
}

// ---------------- Connections ----------------

func (a *API) listConnections(c *gofr.Context) (any, error) {
	return st(c).ListConnections(c, store.ConnectionFilter{
		Name: c.Param("name"), SourceID: c.Param("source_id"), DestinationID: c.Param("destination_id"),
		Status: c.Param("status"),
	}, listParams(c))
}

func (a *API) createConnection(c *gofr.Context) (any, error) {
	var in models.ConnectionInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	return st(c).CreateConnection(c, &in)
}

func (a *API) getConnection(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	conn, err := st(c).GetConnection(c, id)

	return conn, mapErr(err, "connection", id)
}

func (a *API) updateConnection(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	var in models.ConnectionInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	conn, err := st(c).UpdateConnection(c, id, &in)

	return conn, mapErr(err, "connection", id)
}

func (a *API) deleteConnection(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	return nil, mapErr(st(c).DeleteConnection(c, id), "connection", id)
}

func (a *API) setConnectionPaused(paused bool) gofr.Handler {
	return func(c *gofr.Context) (any, error) {
		id := c.PathParam("id")

		conn, err := st(c).SetConnectionPaused(c, id, paused)
		if err == nil && !paused {
			a.notify()
		}

		return conn, mapErr(err, "connection", id)
	}
}

func (a *API) setConnectionDisabled(disabled bool) gofr.Handler {
	return func(c *gofr.Context) (any, error) {
		id := c.PathParam("id")
		conn, err := st(c).SetConnectionDisabled(c, id, disabled)

		return conn, mapErr(err, "connection", id)
	}
}

// ---------------- Requests ----------------

func (a *API) listRequests(c *gofr.Context) (any, error) {
	from, err := parseTime(c, "from")
	if err != nil {
		return nil, err
	}

	to, err := parseTime(c, "to")
	if err != nil {
		return nil, err
	}

	body, err := rawJSONParam(c, "body")
	if err != nil {
		return nil, err
	}

	return st(c).ListRequests(c, store.RequestFilter{
		SourceID: c.Param("source_id"), Status: c.Param("status"), Cause: c.Param("cause"), Method: c.Param("method"),
		From: from, To: to, Search: c.Param("search"), Body: body,
	}, listParams(c))
}

func (a *API) getRequest(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	r, err := st(c).GetRequest(c, id)

	return r, mapErr(err, "request", id)
}

// retryRequest accepts a rejected request (bypassing the original rejection) and routes it to connections.
func (a *API) retryRequest(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	req, err := st(c).AcceptRequest(c, id)
	if errors.Is(err, store.ErrNotFound) {
		if _, gerr := st(c).GetRequest(c, id); gerr == nil {
			return nil, apierr.Conflict("only rejected requests can be retried")
		}

		return nil, apierr.NotFound("request", id)
	}

	if err != nil {
		return nil, err
	}

	created, ignored, err := ingest.FanOut(c, store.New(dbFor(c)), a.Log, req)
	if err != nil {
		return nil, err
	}

	if created > 0 {
		a.notify()
	}

	return map[string]any{"request_id": id, "events": created, "ignored": ignored}, nil
}

func requestFilter(c *gofr.Context) (store.RequestFilter, error) {
	body, err := rawJSONParam(c, "body")
	if err != nil {
		return store.RequestFilter{}, err
	}

	return store.RequestFilter{
		SourceID: c.Param("source_id"), Status: c.Param("status"), Cause: c.Param("cause"), Method: c.Param("method"),
		Search: c.Param("search"), Body: body,
	}, nil
}

// requestHistogram powers the Requests timeline (same filters as /requests, ?buckets=N).
func (a *API) requestHistogram(c *gofr.Context) (any, error) {
	f, err := requestFilter(c)
	if err != nil {
		return nil, err
	}

	from, to, err := rangeParams(c)
	if err != nil {
		return nil, err
	}

	n, _ := strconv.Atoi(c.Param("buckets"))
	if n <= 0 || n > 500 {
		n = 60
	}

	bucket := max(to.Sub(from)/time.Duration(n), time.Second).Truncate(time.Second)

	buckets, err := st(c).RequestHistogram(c, f, from.Truncate(bucket), to, bucket)
	if err != nil {
		return nil, err
	}

	return map[string]any{"bucket_seconds": int(bucket.Seconds()), "buckets": buckets}, nil
}

const bulkRequestRetryLimit = 500

type bulkRequestInput struct {
	Query struct {
		SourceID string          `json:"source_id"`
		Cause    string          `json:"cause"`
		Method   string          `json:"method"`
		From     *time.Time      `json:"from"`
		To       *time.Time      `json:"to"`
		Search   string          `json:"search"`
		Body     json.RawMessage `json:"body"`
	} `json:"query"`
}

// bulkRetryRequests accepts every rejected request matching the query (up to 500 per call) and routes it.
func (a *API) bulkRetryRequests(c *gofr.Context) (any, error) {
	var in bulkRequestInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	q := in.Query
	f := store.RequestFilter{SourceID: q.SourceID, Cause: q.Cause, Method: q.Method, From: q.From, To: q.To, Search: q.Search}

	if len(q.Body) > 0 && string(q.Body) != "null" {
		f.Body = q.Body
	}

	ids, err := st(c).RejectedRequestIDs(c, f, bulkRequestRetryLimit)
	if err != nil {
		return nil, err
	}

	retried, events := 0, 0

	for _, id := range ids {
		req, err := st(c).AcceptRequest(c, id)
		if err != nil {
			continue // raced with another retry
		}

		n, _, err := ingest.FanOut(c, store.New(dbFor(c)), a.Log, req)
		if err != nil {
			return nil, err
		}

		retried++
		events += n
	}

	if events > 0 {
		a.notify()
	}

	return map[string]any{"retried": retried, "events": events, "limit_reached": len(ids) == bulkRequestRetryLimit}, nil
}

func (a *API) listRequestEvents(c *gofr.Context) (any, error) {
	return st(c).ListEvents(c, store.EventFilter{RequestID: c.PathParam("id")}, listParams(c), false)
}

// ---------------- Events ----------------

func eventFilter(c *gofr.Context) (store.EventFilter, error) {
	from, err := parseTime(c, "from")
	if err != nil {
		return store.EventFilter{}, err
	}

	to, err := parseTime(c, "to")
	if err != nil {
		return store.EventFilter{}, err
	}

	body, err := rawJSONParam(c, "body")
	if err != nil {
		return store.EventFilter{}, err
	}

	headers, err := rawJSONParam(c, "headers")
	if err != nil {
		return store.EventFilter{}, err
	}

	return store.EventFilter{
		Status: c.Param("status"), ConnectionID: c.Param("connection_id"), SourceID: c.Param("source_id"),
		DestinationID: c.Param("destination_id"), RequestID: c.Param("request_id"),
		ResponseStatus: c.Param("response_status"), ErrorCode: c.Param("error_code"),
		From: from, To: to, Search: c.Param("search"), Body: body, Headers: headers,
	}, nil
}

func (a *API) listEvents(c *gofr.Context) (any, error) {
	f, err := eventFilter(c)
	if err != nil {
		return nil, err
	}

	return st(c).ListEvents(c, f, listParams(c), c.Param("include") == "data")
}

// eventHistogram powers the timeline: ?from&to (default last 24h) &buckets=N (default 48).
func (a *API) eventHistogram(c *gofr.Context) (any, error) {
	f, err := eventFilter(c)
	if err != nil {
		return nil, err
	}

	to := time.Now().UTC()
	if f.To != nil {
		to = *f.To
	}

	from := to.Add(-24 * time.Hour)
	if f.From != nil {
		from = *f.From
	}

	if !from.Before(to) {
		return nil, apierr.BadRequest("from must be before to")
	}

	n, _ := strconv.Atoi(c.Param("buckets"))
	if n <= 0 || n > 500 {
		n = 48
	}

	bucket := max(to.Sub(from)/time.Duration(n), time.Second).Truncate(time.Second)

	buckets, err := st(c).EventHistogram(c, f, from.Truncate(bucket), to, bucket)
	if err != nil {
		return nil, err
	}

	return map[string]any{"bucket_seconds": int(bucket.Seconds()), "buckets": buckets}, nil
}

func (a *API) getEvent(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	e, err := st(c).GetEvent(c, id)

	return e, mapErr(err, "event", id)
}

func (a *API) listEventAttempts(c *gofr.Context) (any, error) {
	return st(c).ListAttempts(c, c.PathParam("id"), listParams(c))
}

func (a *API) retryEvent(c *gofr.Context) (any, error) {
	id := c.PathParam("id")

	e, err := st(c).RetryEvent(c, id)
	if err == nil {
		a.notify()
	}

	return e, mapErr(err, "event", id)
}

func (a *API) cancelEvent(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	e, err := st(c).CancelEvent(c, id)

	return e, mapErr(err, "event", id)
}

type bulkInput struct {
	Query struct {
		Status         string          `json:"status"`
		ConnectionID   string          `json:"connection_id"`
		SourceID       string          `json:"source_id"`
		DestinationID  string          `json:"destination_id"`
		ResponseStatus string          `json:"response_status"`
		ErrorCode      string          `json:"error_code"`
		From           *time.Time      `json:"from"`
		To             *time.Time      `json:"to"`
		Search         string          `json:"search"`
		Body           json.RawMessage `json:"body"`
		IDs            string          `json:"id"`
	} `json:"query"`
}

func (b *bulkInput) filter() store.EventFilter {
	q := b.Query

	f := store.EventFilter{
		Status: q.Status, ConnectionID: q.ConnectionID, SourceID: q.SourceID, DestinationID: q.DestinationID,
		ResponseStatus: q.ResponseStatus, ErrorCode: q.ErrorCode, From: q.From, To: q.To, Search: q.Search, Body: q.Body,
	}

	if len(f.Body) == 0 || string(f.Body) == "null" {
		f.Body = nil
	}

	return f
}

func (a *API) bulkRetry(c *gofr.Context) (any, error) {
	var in bulkInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	n, err := st(c).BulkRetry(c, in.filter())
	if err != nil {
		return nil, err
	}

	a.notify()

	return map[string]any{"queued": n}, nil
}

func (a *API) bulkCancel(c *gofr.Context) (any, error) {
	var in bulkInput
	if err := bind(c, &in); err != nil {
		return nil, err
	}

	n, err := st(c).BulkCancel(c, in.filter())
	if err != nil {
		return nil, err
	}

	return map[string]any{"cancelled": n}, nil
}

// ---------------- Attempts ----------------

func (a *API) listAttempts(c *gofr.Context) (any, error) {
	return st(c).ListAttempts(c, c.Param("event_id"), listParams(c))
}

func (a *API) getAttempt(c *gofr.Context) (any, error) {
	id := c.PathParam("id")
	at, err := st(c).GetAttempt(c, id)

	return at, mapErr(err, "attempt", id)
}

// ---------------- Stats ----------------

func (a *API) stats(c *gofr.Context) (any, error) {
	return st(c).Stats(c)
}

func (a *API) notify() {
	if a.Notify != nil {
		a.Notify()
	}
}
