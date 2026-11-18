// Package delivery leases due events from Postgres and delivers them to destinations with retries.
package delivery

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/zopping/easewebhook/backend/internal/ids"
	"github.com/zopping/easewebhook/backend/internal/models"
	"github.com/zopping/easewebhook/backend/internal/store"
)

const (
	maxDBBackoff    = time.Minute
	maxResponseBody = 64 << 10
	maxBackoff      = 24 * time.Hour
)

type Logger interface {
	Errorf(format string, args ...any)
	Infof(format string, args ...any)
	Debugf(format string, args ...any)
}

type Config struct {
	Concurrency  int
	BatchSize    int
	PollInterval time.Duration
	Timeout      time.Duration
}

type Worker struct {
	st      *store.Store
	log     Logger
	cfg     Config
	client  *http.Client
	wake    chan struct{}
	limiter *rateLimiter
}

func NewWorker(st *store.Store, log Logger, cfg Config) *Worker {
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 10
	}

	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 20
	}

	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 500 * time.Millisecond
	}

	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}

	return &Worker{
		st: st, log: log, cfg: cfg,
		client: &http.Client{
			Timeout: cfg.Timeout,
			// don't follow redirects: report the 3xx like Hookdeck does
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		wake:    make(chan struct{}, 1),
		limiter: newRateLimiter(),
	}
}

// Notify wakes the worker immediately (called after ingestion).
func (w *Worker) Notify() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// Run blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	sem := make(chan struct{}, w.cfg.Concurrency)
	ticker := time.NewTicker(w.cfg.PollInterval)

	defer ticker.Stop()

	var wg sync.WaitGroup

	w.log.Infof("delivery worker started (concurrency=%d)", w.cfg.Concurrency)

	var (
		failures int           // consecutive database errors
		backoff  time.Duration // extra wait while the database is failing
	)

	for {
		// drain as long as there's work and free slots
		for {
			free := w.cfg.Concurrency - len(sem)
			if free <= 0 {
				break
			}

			n := min(free, w.cfg.BatchSize)
			lease := w.cfg.Timeout + 30*time.Second

			events, err := w.st.ClaimDueEvents(ctx, n, lease)
			if err != nil {
				if ctx.Err() == nil {
					failures++
					backoff = min(time.Duration(1<<min(failures-1, 6))*time.Second, maxDBBackoff)
					w.log.Errorf("claiming events (retrying in %s): %v", backoff, err)
				}

				break
			}

			if failures > 0 {
				w.log.Infof("database reachable again after %d failed attempt(s)", failures)
				failures, backoff = 0, 0
			}

			for i := range events {
				sem <- struct{}{}

				wg.Add(1)

				go func(e models.Event) {
					defer func() { <-sem; wg.Done() }()
					w.process(ctx, &e)
				}(events[i])
			}

			if len(events) < n {
				break
			}
		}

		// While the database is failing (bad password, outage) wait longer between attempts, so we don't
		// hammer it: Supabase's pooler blocks all logins after repeated authentication failures.
		if backoff > 0 {
			select {
			case <-ctx.Done():
				wg.Wait()
				return
			case <-time.After(backoff):
			}

			continue
		}

		select {
		case <-ctx.Done():
			wg.Wait()
			return
		case <-ticker.C:
		case <-w.wake:
		}
	}
}

func (w *Worker) process(ctx context.Context, e *models.Event) {
	conn, err := w.st.GetConnection(ctx, e.ConnectionID)
	if err != nil {
		w.log.Errorf("event %s: loading connection: %v", e.ID, err)
		_ = w.st.Reschedule(ctx, e.ID, time.Now().Add(time.Minute))

		return
	}

	dest := conn.Destination

	// paused connection or disabled destination: hold until resumed
	if conn.PausedAt != nil || dest.DisabledAt != nil {
		_ = w.st.RecordHold(ctx, e.ID)
		return
	}

	if dest.RateLimit != nil {
		if wait := w.limiter.reserve(dest.ID, *dest.RateLimit, dest.RateLimitPeriod); wait > 0 {
			_ = w.st.Reschedule(ctx, e.ID, time.Now().Add(wait))
			return
		}
	}

	trigger := "INITIAL"

	switch {
	case e.Status == models.EventScheduled && e.Attempts > 0:
		trigger = "AUTOMATIC"
	case e.Attempts > 0:
		trigger = "MANUAL"
	}

	meta := deliveryMeta{SourceName: conn.Source.Name}
	if r, err := w.st.GetRequest(ctx, e.RequestID); err == nil {
		meta.Verified = r.Verified != nil && *r.Verified
		if r.OriginalIP != nil {
			meta.OriginalIP = *r.OriginalIP
		}
	}

	attempt := w.deliver(ctx, e, dest, trigger, meta)

	outcome := &store.AttemptOutcome{Attempt: attempt}

	if attempt.Status == "SUCCESSFUL" {
		outcome.EventStatus = models.EventSuccessful
	} else if next, ok := nextRetry(conn.Rules, e.Attempts+1, trigger); ok {
		outcome.EventStatus = models.EventScheduled
		outcome.NextAttemptAt = &next
	} else {
		outcome.EventStatus = models.EventFailed
	}

	if err := w.st.RecordAttempt(ctx, outcome); err != nil {
		w.log.Errorf("event %s: recording attempt: %v", e.ID, err)
	}
}

// nextRetry applies the connection's retry rule. attemptsDone includes the one just made.
func nextRetry(rules []models.Rule, attemptsDone int, trigger string) (time.Time, bool) {
	if trigger == "MANUAL" {
		return time.Time{}, false
	}

	for _, r := range rules {
		if r.Type != "retry" || r.Count <= 0 {
			continue
		}

		// attemptsDone-1 retries have happened so far
		if attemptsDone-1 >= r.Count {
			return time.Time{}, false
		}

		interval := time.Duration(r.Interval) * time.Millisecond
		if r.Strategy == "exponential" {
			interval = time.Duration(float64(interval) * math.Pow(2, float64(attemptsDone-1)))
		}

		if interval > maxBackoff || interval <= 0 {
			interval = maxBackoff
		}

		return time.Now().Add(interval), true
	}

	return time.Time{}, false
}

var hopHeaders = map[string]bool{
	"host": true, "content-length": true, "connection": true, "transfer-encoding": true, "accept-encoding": true,
	"keep-alive": true, "proxy-connection": true, "te": true, "upgrade": true, "trailer": true,
}

func buildURL(dest *models.Destination, e *models.Event) (string, error) {
	u, err := url.Parse(dest.URL)
	if err != nil {
		return "", err
	}

	if dest.PathForwarding && e.Path != "" {
		u.Path = strings.TrimRight(u.Path, "/") + e.Path
	}

	if e.Query != "" {
		if u.RawQuery != "" {
			u.RawQuery += "&" + e.Query
		} else {
			u.RawQuery = e.Query
		}
	}

	return u.String(), nil
}

// deliveryMeta is context about the originating request, forwarded as X-Ease-* headers.
type deliveryMeta struct {
	SourceName string
	OriginalIP string
	Verified   bool
}

func (w *Worker) deliver(ctx context.Context, e *models.Event, dest *models.Destination, trigger string, meta deliveryMeta) *models.Attempt {
	a := &models.Attempt{
		ID: ids.New(ids.Attempt), EventID: e.ID, AttemptNumber: e.Attempts + 1, Trigger: trigger,
		HTTPMethod: e.Method, Status: "FAILED",
	}

	if dest.HTTPMethod != nil {
		a.HTTPMethod = *dest.HTTPMethod
	}

	fail := func(code, msg string) *models.Attempt {
		a.ErrorCode, a.ErrorMessage = &code, &msg
		return a
	}

	target, err := buildURL(dest, e)
	a.RequestedURL = target

	if err != nil {
		a.RequestedURL = dest.URL
		return fail("INVALID_URL", err.Error())
	}

	body := ""
	if e.RawBody != nil {
		body = *e.RawBody
	}

	var auth models.DestinationAuth
	if len(dest.Auth) > 0 {
		_ = json.Unmarshal(dest.Auth, &auth)
	}

	if dest.AuthType == models.AuthAPIKey && strings.EqualFold(auth.To, "query") && auth.Key != "" {
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}

		target += sep + url.QueryEscape(auth.Key) + "=" + url.QueryEscape(auth.APIKey)
	}

	req, err := http.NewRequestWithContext(ctx, a.HTTPMethod, target, bytes.NewBufferString(body))
	if err != nil {
		return fail("INVALID_REQUEST", err.Error())
	}

	for k, v := range e.Headers {
		if !hopHeaders[strings.ToLower(k)] {
			req.Header.Set(k, v)
		}
	}

	ts := strconv.FormatInt(time.Now().Unix(), 10)
	req.Header.Set("User-Agent", "EaseWebhook/1.0")
	req.Header.Set("X-Ease-Event-Id", e.ID)
	req.Header.Set("X-Ease-Request-Id", e.RequestID)
	req.Header.Set("X-Ease-Attempt", strconv.Itoa(a.AttemptNumber))
	req.Header.Set("X-Ease-Timestamp", ts)
	// Same value on every retry of this event, so receivers can de-duplicate.
	req.Header.Set("Idempotency-Key", e.ID)
	req.Header.Set("X-Ease-Source-Name", meta.SourceName)
	req.Header.Set("X-Ease-Verified", strconv.FormatBool(meta.Verified))

	if meta.OriginalIP != "" {
		req.Header.Set("X-Ease-Original-Ip", meta.OriginalIP)
	}

	applyAuth(req, dest.AuthType, &auth, body, ts)

	a.RequestHeaders = map[string]string{}
	for k := range req.Header {
		v := req.Header.Get(k)
		if strings.EqualFold(k, "Authorization") || strings.EqualFold(k, auth.Key) {
			v = "[redacted]"
		}

		a.RequestHeaders[k] = v
	}

	start := time.Now()
	resp, err := w.client.Do(req)
	dur := int(time.Since(start).Milliseconds())
	a.DurationMS = &dur

	if err != nil {
		return fail(classifyError(err), err.Error())
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBody))
	rb := string(respBody)
	code := resp.StatusCode

	a.ResponseStatus, a.ResponseBody = &code, &rb
	a.ResponseHeaders = map[string]string{}

	for k := range resp.Header {
		a.ResponseHeaders[k] = resp.Header.Get(k)
	}

	if code >= 200 && code < 300 {
		a.Status = "SUCCESSFUL"
		return a
	}

	return fail("HTTP_"+strconv.Itoa(code), fmt.Sprintf("destination responded with %d", code))
}

func applyAuth(req *http.Request, authType string, auth *models.DestinationAuth, body, ts string) {
	switch authType {
	case models.AuthBearer:
		req.Header.Set("Authorization", "Bearer "+auth.Token)
	case models.AuthBasic:
		req.SetBasicAuth(auth.Username, auth.Password)
	case models.AuthAPIKey:
		if !strings.EqualFold(auth.To, "query") && auth.Key != "" {
			req.Header.Set(auth.Key, auth.APIKey)
		}
	case models.AuthSignature:
		mac := hmac.New(sha256.New, []byte(auth.Secret))
		mac.Write([]byte(ts + "." + body))
		req.Header.Set("X-Ease-Signature", "v1="+hex.EncodeToString(mac.Sum(nil)))
		req.Header.Set("X-Ease-Signature-Base64", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	}
}

func classifyError(err error) string {
	var (
		ne  net.Error
		dns *net.DNSError
		op  *net.OpError
	)

	switch {
	case errors.As(err, &dns):
		return "DNS_LOOKUP_FAILED"
	case errors.As(err, &ne) && ne.Timeout():
		return "TIMEOUT"
	case errors.As(err, &op) && strings.Contains(op.Err.Error(), "refused"):
		return "CONNECTION_REFUSED"
	case strings.Contains(err.Error(), "tls"), strings.Contains(err.Error(), "certificate"):
		return "TLS_ERROR"
	case strings.Contains(err.Error(), "reset"):
		return "CONNECTION_RESET"
	}

	return "NETWORK_ERROR"
}
