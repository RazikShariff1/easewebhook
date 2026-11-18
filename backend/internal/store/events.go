package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zopping/easewebhook/backend/internal/models"
)

// ---------------- Requests ----------------

const reqCols = `id, source_id, method, path, query, headers, body, body_json IS NOT NULL, content_type, verified, status,
	rejection_cause, events_count, ignored_count, original_ip, ingested_at`

func scanRequest(s scanner) (*models.Request, error) {
	var (
		r       models.Request
		headers []byte
		body    *string
		isJSON  bool
	)

	if err := s.Scan(&r.ID, &r.SourceID, &r.Method, &r.Path, &r.Query, &headers, &body, &isJSON, &r.ContentType,
		&r.Verified, &r.Status, &r.RejectionCause, &r.EventsCount, &r.IgnoredCount, &r.OriginalIP, &r.IngestedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	unmarshalNullable(headers, &r.Headers)
	r.Body = decodeBody(body, isJSON)

	return &r, nil
}

func decodeBody(body *string, isJSON bool) any {
	if body == nil {
		return nil
	}

	if isJSON {
		var v any
		if json.Unmarshal([]byte(*body), &v) == nil {
			return v
		}
	}

	return *body
}

// ParseJSONBody returns the raw body for a jsonb column when it is valid JSON, else nil.
func ParseJSONBody(body string) any {
	if body == "" || !json.Valid([]byte(body)) {
		return nil
	}

	return body
}

type NewRequest struct {
	ID             string
	WorkspaceID    string
	SourceID       string
	Method         string
	Path           string
	Query          string
	Headers        map[string]string
	Body           string
	ContentType    string
	Verified       *bool
	Status         string
	RejectionCause *string
	OriginalIP     string
}

func (s *Store) InsertRequest(ctx context.Context, r *NewRequest) error {
	var ct *string
	if r.ContentType != "" {
		ct = &r.ContentType
	}

	_, err := s.db.ExecContext(ctx, `INSERT INTO requests (id, source_id, method, path, query, headers, body, body_json,
		content_type, verified, status, rejection_cause, original_ip, workspace_id)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9,$10,$11,$12,$13,$14)`,
		r.ID, r.SourceID, r.Method, r.Path, r.Query, jsonParam(r.Headers), r.Body, ParseJSONBody(r.Body), ct,
		r.Verified, r.Status, r.RejectionCause, r.OriginalIP, r.WorkspaceID)

	return err
}

// AcceptRequest flips a rejected request to accepted (a manual retry) and returns it ready for fan-out.
func (s *Store) AcceptRequest(ctx context.Context, id string) (*NewRequest, error) {
	var (
		r       NewRequest
		headers []byte
	)

	err := s.db.QueryRowContext(ctx, `UPDATE requests SET status='ACCEPTED', rejection_cause=NULL
		WHERE id=$1 AND status='REJECTED'`+wsCond(2, "workspace_id")+`
		RETURNING id, workspace_id, source_id, method, path, query, headers, COALESCE(body,''), COALESCE(content_type,'')`,
		id, s.ws).Scan(&r.ID, &r.WorkspaceID, &r.SourceID, &r.Method, &r.Path, &r.Query, &headers, &r.Body, &r.ContentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}

	if err != nil {
		return nil, err
	}

	unmarshalNullable(headers, &r.Headers)
	r.Status = "ACCEPTED"

	return &r, nil
}

func (s *Store) SetRequestCounts(ctx context.Context, id string, events, ignored int) error {
	_, err := s.db.ExecContext(ctx, `UPDATE requests SET events_count=$2, ignored_count=$3 WHERE id=$1`, id, events, ignored)
	return err
}

func (s *Store) GetRequest(ctx context.Context, id string) (*models.Request, error) {
	return scanRequest(s.db.QueryRowContext(ctx, `SELECT `+reqCols+` FROM requests WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws))
}

type RequestFilter struct {
	SourceID string
	Status   string
	Cause    string // rejection reason prefix(es), CSV, e.g. "UNSUPPORTED_METHOD,VERIFICATION_FAILED"
	Method   string // CSV
	From, To *time.Time
	Search   string
	Body     json.RawMessage
}

func (s *Store) applyRequestFilter(w *where, f RequestFilter) {
	s.scope(w, "workspace_id")
	w.in("source_id", f.SourceID)
	w.in("status", f.Status)
	w.in("method", strings.ToUpper(f.Method))
	w.in("split_part(COALESCE(rejection_cause,''), ':', 1)", f.Cause)

	if f.From != nil {
		w.add("ingested_at >= ?", *f.From)
	}

	if f.To != nil {
		w.add("ingested_at <= ?", *f.To)
	}

	if f.Search != "" {
		w.add("(body ILIKE ? OR headers::text ILIKE ?)", "%"+f.Search+"%", "%"+f.Search+"%")
	}

	if len(f.Body) > 0 {
		w.add("body_json @> ?::jsonb", string(f.Body))
	}
}

func (s *Store) ListRequests(ctx context.Context, f RequestFilter, p ListParams) (*models.Page[models.Request], error) {
	var w where

	s.applyRequestFilter(&w, f)
	w.cursor("ingested_at", p.Cursor)

	rows, err := s.db.QueryContext(ctx, `SELECT `+reqCols+` FROM requests`+w.sql()+
		` ORDER BY ingested_at DESC, id DESC LIMIT `+w.next(), append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Request]{Models: []models.Request{}}

	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			return nil, err
		}

		page.Models = append(page.Models, *r)
	}

	return paginate(page, p.limit(), func(x models.Request) (time.Time, string) { return x.IngestedAt, x.ID }), rows.Err()
}

// RejectedRequestIDs returns up to limit rejected request IDs matching the filter (oldest first), for bulk retry.
func (s *Store) RejectedRequestIDs(ctx context.Context, f RequestFilter, limit int) ([]string, error) {
	var w where

	f.Status = "REJECTED"
	s.applyRequestFilter(&w, f)

	rows, err := s.db.QueryContext(ctx, `SELECT id FROM requests`+w.sql()+` ORDER BY ingested_at LIMIT `+w.next(), append(w.args, limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string

	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}

		out = append(out, id)
	}

	return out, rows.Err()
}

// ---------------- Events ----------------

const eventCols = `id, request_id, connection_id, source_id, destination_id, status, method, path, query, headers, body,
	body_json IS NOT NULL, attempts, response_status, error_code, last_attempt_at, next_attempt_at, successful_at,
	created_at, updated_at`

func scanEvent(s scanner) (*models.Event, error) {
	var (
		e       models.Event
		headers []byte
		isJSON  bool
	)

	if err := s.Scan(&e.ID, &e.RequestID, &e.ConnectionID, &e.SourceID, &e.DestinationID, &e.Status, &e.Method, &e.Path,
		&e.Query, &headers, &e.RawBody, &isJSON, &e.Attempts, &e.ResponseStatus, &e.ErrorCode, &e.LastAttemptAt,
		&e.NextAttemptAt, &e.SuccessfulAt, &e.CreatedAt, &e.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	unmarshalNullable(headers, &e.Headers)
	e.Body = decodeBody(e.RawBody, isJSON)

	return &e, nil
}

type NewEvent struct {
	ID            string
	WorkspaceID   string
	RequestID     string
	ConnectionID  string
	SourceID      string
	DestinationID string
	Status        string
	Method        string
	Path          string
	Query         string
	Headers       map[string]string
	Body          string
	NextAttemptAt *time.Time
}

func (s *Store) InsertEvent(ctx context.Context, e *NewEvent) error {
	_, err := s.db.ExecContext(ctx, `INSERT INTO events (id, request_id, connection_id, source_id, destination_id, status,
		method, path, query, headers, body, body_json, next_attempt_at, workspace_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12::jsonb,$13,$14)`,
		e.ID, e.RequestID, e.ConnectionID, e.SourceID, e.DestinationID, e.Status, e.Method, e.Path, e.Query,
		jsonParam(e.Headers), e.Body, ParseJSONBody(e.Body), e.NextAttemptAt, e.WorkspaceID)

	return err
}

func (s *Store) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	return scanEvent(s.db.QueryRowContext(ctx, `SELECT `+eventCols+` FROM events WHERE id=$1`+wsCond(2, "workspace_id"), id, s.ws))
}

type EventFilter struct {
	Status         string
	ConnectionID   string
	SourceID       string
	DestinationID  string
	RequestID      string
	ResponseStatus string
	ErrorCode      string
	From, To       *time.Time
	Search         string
	Body           json.RawMessage
	Headers        json.RawMessage
}

func (f *EventFilter) apply(w *where) {
	w.in("status", f.Status)
	w.in("connection_id", f.ConnectionID)
	w.in("source_id", f.SourceID)
	w.in("destination_id", f.DestinationID)
	w.in("request_id", f.RequestID)
	w.in("response_status::text", f.ResponseStatus)
	w.in("error_code", f.ErrorCode)

	if f.From != nil {
		w.add("created_at >= ?", *f.From)
	}

	if f.To != nil {
		w.add("created_at <= ?", *f.To)
	}

	if f.Search != "" {
		w.add("body ILIKE ?", "%"+f.Search+"%")
	}

	if len(f.Body) > 0 {
		w.add("body_json @> ?::jsonb", string(f.Body))
	}

	if len(f.Headers) > 0 {
		w.add("headers @> ?::jsonb", string(f.Headers))
	}
}

func (s *Store) ListEvents(ctx context.Context, f EventFilter, p ListParams, includeBody bool) (*models.Page[models.Event], error) {
	var w where

	f.apply(&w)
	s.scope(&w, "workspace_id")
	w.cursor("created_at", p.Cursor)

	rows, err := s.db.QueryContext(ctx, `SELECT `+eventCols+` FROM events`+w.sql()+
		` ORDER BY created_at DESC, id DESC LIMIT `+w.next(), append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Event]{Models: []models.Event{}}

	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}

		if !includeBody {
			e.Body = nil
		}

		page.Models = append(page.Models, *e)
	}

	return paginate(page, p.limit(), func(x models.Event) (time.Time, string) { return x.CreatedAt, x.ID }), rows.Err()
}

// HistogramBucket is one time slice of event counts by status.
type HistogramBucket struct {
	Time   time.Time      `json:"time"`
	Total  int            `json:"total"`
	Status map[string]int `json:"status"`
	Events int            `json:"events,omitempty"` // request histograms: events created from the bucket's requests
}

func (s *Store) EventHistogram(ctx context.Context, f EventFilter, from, to time.Time, bucket time.Duration) ([]HistogramBucket, error) {
	var w where

	f.From, f.To = &from, &to
	f.apply(&w)
	s.scope(&w, "workspace_id")

	interval := w.next()
	args := append(w.args, pgInterval(bucket))
	originIdx := len(args) + 1
	args = append(args, from)

	q := `SELECT date_bin(` + interval + `::interval, created_at, $` + itoa(originIdx) + `) AS b, status, count(*)
		FROM events` + w.sql() + ` GROUP BY b, status ORDER BY b`

	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byTime := map[time.Time]*HistogramBucket{}

	for rows.Next() {
		var (
			t      time.Time
			status string
			n      int
		)

		if err := rows.Scan(&t, &status, &n); err != nil {
			return nil, err
		}

		b := byTime[t.UTC()]
		if b == nil {
			b = &HistogramBucket{Time: t.UTC(), Status: map[string]int{}}
			byTime[t.UTC()] = b
		}

		b.Status[status] += n
		b.Total += n
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	// emit every bucket in range, including empty ones
	out := []HistogramBucket{}

	for t := from.UTC(); t.Before(to); t = t.Add(bucket) {
		if b, ok := byTime[t]; ok {
			out = append(out, *b)
		} else {
			out = append(out, HistogramBucket{Time: t, Status: map[string]int{}})
		}
	}

	return out, nil
}

func itoa(n int) string { return strconv.Itoa(n) }

// pgInterval renders a duration as a Postgres interval literal.
func pgInterval(d time.Duration) string {
	return strconv.FormatInt(d.Milliseconds(), 10) + " milliseconds"
}

// CountEventsByStatus returns totals per status for the filter.
func (s *Store) CountEventsByStatus(ctx context.Context, f EventFilter) (map[string]int, error) {
	var w where

	f.apply(&w)
	s.scope(&w, "workspace_id")

	rows, err := s.db.QueryContext(ctx, `SELECT status, count(*) FROM events`+w.sql()+` GROUP BY status`, w.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]int{}

	for rows.Next() {
		var (
			st string
			n  int
		)

		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}

		out[st] = n
	}

	return out, rows.Err()
}

// RetryEvent queues an event for immediate manual delivery.
func (s *Store) RetryEvent(ctx context.Context, id string) (*models.Event, error) {
	return scanEvent(s.db.QueryRowContext(ctx, `UPDATE events SET status='QUEUED', next_attempt_at=now(), locked_until=NULL,
		updated_at=now() WHERE id=$1`+wsCond(2, "workspace_id")+` RETURNING `+eventCols, id, s.ws))
}

// CancelEvent cancels a pending (queued/scheduled/held) event.
func (s *Store) CancelEvent(ctx context.Context, id string) (*models.Event, error) {
	e, err := s.GetEvent(ctx, id)
	if err != nil {
		return nil, err
	}

	if e.Status != models.EventQueued && e.Status != models.EventScheduled && e.Status != models.EventHold {
		return e, nil
	}

	return scanEvent(s.db.QueryRowContext(ctx, `UPDATE events SET status='CANCELLED', next_attempt_at=NULL, updated_at=now()
		WHERE id=$1`+wsCond(2, "workspace_id")+` RETURNING `+eventCols, id, s.ws))
}

// BulkRetry re-queues all events matching the filter that are FAILED (or the given statuses).
func (s *Store) BulkRetry(ctx context.Context, f EventFilter) (int64, error) {
	if f.Status == "" {
		f.Status = "FAILED"
	}

	var w where

	f.apply(&w)
	s.scope(&w, "workspace_id")

	res, err := s.db.ExecContext(ctx, `UPDATE events SET status='QUEUED', next_attempt_at=now(), locked_until=NULL,
		updated_at=now()`+w.sql(), w.args...)
	if err != nil {
		return 0, err
	}

	return res.RowsAffected()
}

// BulkCancel cancels all pending events matching the filter.
func (s *Store) BulkCancel(ctx context.Context, f EventFilter) (int64, error) {
	var w where

	f.apply(&w)
	s.scope(&w, "workspace_id")
	w.add("status IN ('QUEUED','SCHEDULED','HOLD')")

	res, err := s.db.ExecContext(ctx, `UPDATE events SET status='CANCELLED', next_attempt_at=NULL, updated_at=now()`+w.sql(), w.args...)
	if err != nil {
		return 0, err
	}

	return res.RowsAffected()
}

// ---------------- Worker queue ----------------

// ClaimDueEvents atomically leases up to n due events for delivery.
func (s *Store) ClaimDueEvents(ctx context.Context, n int, lease time.Duration) ([]models.Event, error) {
	rows, err := s.db.QueryContext(ctx, `UPDATE events SET locked_until = now() + $2::interval, updated_at=now()
		WHERE id IN (
			SELECT id FROM events
			WHERE status IN ('QUEUED','SCHEDULED') AND next_attempt_at <= now()
			  AND (locked_until IS NULL OR locked_until < now())
			ORDER BY next_attempt_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		) RETURNING `+eventCols, n, pgInterval(lease))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Event

	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}

		out = append(out, *e)
	}

	return out, rows.Err()
}

// ExtendLease pushes an event's lease/next attempt forward (used when rate limited).
func (s *Store) Reschedule(ctx context.Context, id string, at time.Time) error {
	_, err := s.db.ExecContext(ctx, `UPDATE events SET next_attempt_at=$2, locked_until=NULL, updated_at=now() WHERE id=$1`, id, at)
	return err
}

// FinishAttempt records an attempt and updates the event outcome.
type AttemptOutcome struct {
	Attempt       *models.Attempt
	EventStatus   string
	NextAttemptAt *time.Time
}

func (s *Store) RecordAttempt(ctx context.Context, o *AttemptOutcome) error {
	a := o.Attempt

	_, err := s.db.ExecContext(ctx, `INSERT INTO attempts (id, event_id, attempt_number, trigger, status, requested_url,
		http_method, request_headers, response_status, response_headers, response_body, error_code, error_message, duration_ms)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14)`,
		a.ID, a.EventID, a.AttemptNumber, a.Trigger, a.Status, a.RequestedURL, a.HTTPMethod, jsonParam(a.RequestHeaders),
		a.ResponseStatus, jsonParam(a.ResponseHeaders), a.ResponseBody, a.ErrorCode, a.ErrorMessage, a.DurationMS)
	if err != nil {
		return err
	}

	// Don't overwrite a status that changed (e.g. CANCELLED) while the attempt was in flight,
	// except when the attempt itself succeeded.
	_, err = s.db.ExecContext(ctx, `UPDATE events SET
			status = CASE WHEN status='CANCELLED' AND $2 <> 'SUCCESSFUL' THEN status ELSE $2 END,
			attempts = attempts + 1, response_status=$3, error_code=$4, last_attempt_at=now(),
			next_attempt_at = CASE WHEN status='CANCELLED' AND $2 <> 'SUCCESSFUL' THEN NULL ELSE $5::timestamptz END,
			successful_at = CASE WHEN $2='SUCCESSFUL' THEN now() ELSE successful_at END,
			locked_until=NULL, updated_at=now()
		WHERE id=$1`, a.EventID, o.EventStatus, a.ResponseStatus, a.ErrorCode, o.NextAttemptAt)

	return err
}

// ---------------- Attempts ----------------

const attemptCols = `id, event_id, attempt_number, trigger, status, requested_url, http_method, request_headers,
	response_status, response_headers, response_body, error_code, error_message, duration_ms, created_at`

func scanAttempt(s scanner) (*models.Attempt, error) {
	var (
		a          models.Attempt
		reqH, resH []byte
	)

	if err := s.Scan(&a.ID, &a.EventID, &a.AttemptNumber, &a.Trigger, &a.Status, &a.RequestedURL, &a.HTTPMethod, &reqH,
		&a.ResponseStatus, &resH, &a.ResponseBody, &a.ErrorCode, &a.ErrorMessage, &a.DurationMS, &a.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}

		return nil, err
	}

	unmarshalNullable(reqH, &a.RequestHeaders)
	unmarshalNullable(resH, &a.ResponseHeaders)

	return &a, nil
}

func (s *Store) ListAttempts(ctx context.Context, eventID string, p ListParams) (*models.Page[models.Attempt], error) {
	var w where

	w.in("event_id", eventID)

	if s.ws != "" {
		w.add("event_id IN (SELECT id FROM events WHERE workspace_id = ?)", s.ws)
	}
	w.cursor("created_at", p.Cursor)

	rows, err := s.db.QueryContext(ctx, `SELECT `+attemptCols+` FROM attempts`+w.sql()+
		` ORDER BY created_at DESC, id DESC LIMIT `+w.next(), append(w.args, p.limit()+1)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	page := &models.Page[models.Attempt]{Models: []models.Attempt{}}

	for rows.Next() {
		a, err := scanAttempt(rows)
		if err != nil {
			return nil, err
		}

		page.Models = append(page.Models, *a)
	}

	return paginate(page, p.limit(), func(x models.Attempt) (time.Time, string) { return x.CreatedAt, x.ID }), rows.Err()
}

func (s *Store) GetAttempt(ctx context.Context, id string) (*models.Attempt, error) {
	return scanAttempt(s.db.QueryRowContext(ctx, `SELECT `+attemptCols+` FROM attempts WHERE id=$1
		AND ($2::text = '' OR event_id IN (SELECT id FROM events WHERE workspace_id = $2))`, id, s.ws))
}

// ---------------- Stats ----------------

type Stats struct {
	Requests24h    map[string]int `json:"requests_24h"`     // source_id -> count
	Attempts24h    map[string]int `json:"attempts_24h"`     // destination_id -> count
	EventsByStatus map[string]int `json:"events_by_status"` // last 24h
}

func (s *Store) Stats(ctx context.Context) (*Stats, error) {
	st := &Stats{Requests24h: map[string]int{}, Attempts24h: map[string]int{}}
	from := time.Now().Add(-24 * time.Hour)

	// three independent queries: run them concurrently so the call costs one round trip, not three
	var (
		wg   sync.WaitGroup
		errs [3]error
	)

	wg.Add(3)

	go func() {
		defer wg.Done()
		errs[0] = s.groupCount(ctx, `SELECT source_id, count(*) FROM requests WHERE ingested_at > now() - interval '24 hours'
			AND ($1::text = '' OR workspace_id = $1) GROUP BY source_id`, st.Requests24h, s.ws)
	}()

	go func() {
		defer wg.Done()
		errs[1] = s.groupCount(ctx, `SELECT e.destination_id, count(*) FROM attempts a JOIN events e ON e.id=a.event_id
			WHERE a.created_at > now() - interval '24 hours' AND ($1::text = '' OR e.workspace_id = $1)
			GROUP BY e.destination_id`, st.Attempts24h, s.ws)
	}()

	go func() {
		defer wg.Done()
		st.EventsByStatus, errs[2] = s.CountEventsByStatus(ctx, EventFilter{From: &from})
	}()

	wg.Wait()

	if err := errors.Join(errs[:]...); err != nil {
		return nil, err
	}

	return st, nil
}

func (s *Store) groupCount(ctx context.Context, q string, out map[string]int, args ...any) error {
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			k string
			n int
		)

		if err := rows.Scan(&k, &n); err != nil {
			return err
		}

		out[k] = n
	}

	return rows.Err()
}

// RecordHold parks an event until its connection is resumed / destination enabled.
func (s *Store) RecordHold(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE events SET status='HOLD', locked_until=NULL, updated_at=now()
		WHERE id=$1 AND status IN ('QUEUED','SCHEDULED')`, id)
	return err
}

// ReleaseHeldForDestination re-queues held events once a destination is enabled again.
func (s *Store) ReleaseHeldForDestination(ctx context.Context, destinationID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE events e SET status='QUEUED', next_attempt_at=now(), updated_at=now()
		FROM connections c WHERE c.id=e.connection_id AND c.paused_at IS NULL
		AND e.destination_id=$1 AND e.status='HOLD'`, destinationID)
	return err
}

// ---------------- Destination stats ----------------

type ResponseCount struct {
	Response string `json:"response"` // HTTP status ("200"), error code ("TIMEOUT"), or "none" (not attempted yet)
	Count    int    `json:"count"`
}

type DestinationStats struct {
	Pending         int             `json:"pending"`
	OldestPendingAt *time.Time      `json:"oldest_pending_at"`
	Responses       []ResponseCount `json:"responses"`
	Connections     int             `json:"connections"`
}

// DestinationStats returns live pending counts plus the response breakdown for events created in [from, to].
func (s *Store) DestinationStats(ctx context.Context, destinationID string, from, to time.Time) (*DestinationStats, error) {
	out := &DestinationStats{Responses: []ResponseCount{}}

	if err := s.db.QueryRowContext(ctx, `SELECT count(*), min(created_at) FROM events
		WHERE destination_id=$1 AND status IN ('QUEUED','SCHEDULED','HOLD')`+wsCond(2, "workspace_id"),
		destinationID, s.ws).Scan(&out.Pending, &out.OldestPendingAt); err != nil {
		return nil, err
	}

	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM connections WHERE destination_id=$1`+wsCond(2, "workspace_id"),
		destinationID, s.ws).Scan(&out.Connections); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT COALESCE(response_status::text, error_code, 'none') AS r, count(*) FROM events
		WHERE destination_id=$1 AND created_at BETWEEN $2 AND $3`+wsCond(4, "workspace_id")+` GROUP BY r ORDER BY 2 DESC`,
		destinationID, from, to, s.ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var rc ResponseCount
		if err := rows.Scan(&rc.Response, &rc.Count); err != nil {
			return nil, err
		}

		out.Responses = append(out.Responses, rc)
	}

	return out, rows.Err()
}

// ---------------- Source stats ----------------

// RequestHistogram counts a source's requests per time bucket by status (ACCEPTED / REJECTED).
func (s *Store) RequestHistogram(ctx context.Context, f RequestFilter, from, to time.Time, bucket time.Duration) ([]HistogramBucket, error) {
	var w where

	f.From, f.To = &from, &to
	s.applyRequestFilter(&w, f)

	interval := w.next()
	args := append(w.args, pgInterval(bucket))
	args = append(args, from)

	rows, err := s.db.QueryContext(ctx, `SELECT date_bin(`+interval+`::interval, ingested_at, $`+itoa(len(args))+`) AS b, status, count(*), COALESCE(sum(events_count), 0)
		FROM requests`+w.sql()+` GROUP BY b, status ORDER BY b`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byTime := map[time.Time]*HistogramBucket{}

	for rows.Next() {
		var (
			t      time.Time
			status string
			n, ev  int
		)

		if err := rows.Scan(&t, &status, &n, &ev); err != nil {
			return nil, err
		}

		b := byTime[t.UTC()]
		if b == nil {
			b = &HistogramBucket{Time: t.UTC(), Status: map[string]int{}}
			byTime[t.UTC()] = b
		}

		b.Status[status] += n
		b.Total += n
		b.Events += ev
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := []HistogramBucket{}

	for t := from.UTC(); t.Before(to); t = t.Add(bucket) {
		if b, ok := byTime[t]; ok {
			out = append(out, *b)
		} else {
			out = append(out, HistogramBucket{Time: t, Status: map[string]int{}})
		}
	}

	return out, nil
}

type SourceStats struct {
	Requests    int             `json:"requests"`
	Accepted    int             `json:"accepted"`
	Rejections  []ResponseCount `json:"rejections"` // by cause
	Events      int             `json:"events"`
	Ignored     int             `json:"ignored"`
	LastRequest *time.Time      `json:"last_request_at"`
}

// SourceStats summarises a source's requests in [from, to].
func (s *Store) SourceStats(ctx context.Context, sourceID string, from, to time.Time) (*SourceStats, error) {
	out := &SourceStats{Rejections: []ResponseCount{}}

	if err := s.db.QueryRowContext(ctx, `SELECT count(*), count(*) FILTER (WHERE status='ACCEPTED'),
			COALESCE(sum(events_count),0), COALESCE(sum(ignored_count),0)
		FROM requests WHERE source_id=$1 AND ingested_at BETWEEN $2 AND $3`+wsCond(4, "workspace_id"),
		sourceID, from, to, s.ws).Scan(&out.Requests, &out.Accepted, &out.Events, &out.Ignored); err != nil {
		return nil, err
	}

	if err := s.db.QueryRowContext(ctx, `SELECT max(ingested_at) FROM requests WHERE source_id=$1`+wsCond(2, "workspace_id"),
		sourceID, s.ws).Scan(&out.LastRequest); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT split_part(COALESCE(rejection_cause,'REJECTED'), ':', 1) AS c, count(*) FROM requests
		WHERE source_id=$1 AND status='REJECTED' AND ingested_at BETWEEN $2 AND $3`+wsCond(4, "workspace_id")+` GROUP BY c ORDER BY 2 DESC`,
		sourceID, from, to, s.ws)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var rc ResponseCount
		if err := rows.Scan(&rc.Response, &rc.Count); err != nil {
			return nil, err
		}

		out.Rejections = append(out.Rejections, rc)
	}

	return out, rows.Err()
}
