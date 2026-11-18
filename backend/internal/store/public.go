package store

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"
)

// PublicStats are platform-wide aggregates shown on the public landing page. They contain counts and
// latencies only: no workspace, source or payload data.
type PublicStats struct {
	WindowHours   int            `json:"window_hours"`
	BucketMinutes int            `json:"bucket_minutes"`
	Series        []PublicBucket `json:"series"`

	// end-to-end delivery latency over the window: request received -> first delivery attempt finished
	AvgLatencyMS *float64 `json:"avg_latency_ms"`
	P99LatencyMS *float64 `json:"p99_latency_ms"`

	Requests24h      int      `json:"requests_24h"`
	RequestsLast15m  int      `json:"requests_last_15m"`
	RequestsTotal    int      `json:"requests_total"`
	DistinctSources  int      `json:"distinct_sources"`
	EventsDelivered  int      `json:"events_delivered"`
	DeliverySuccess  *float64 `json:"delivery_success_rate"` // successful / (successful + failed), all time
	SourceTypesInUse []string `json:"source_types_in_use"`   // types that received traffic in the last 30 days, busiest first
	GeneratedAt      string   `json:"generated_at"`
}

type PublicBucket struct {
	Time     string   `json:"time"`
	Requests int      `json:"requests"`
	AvgMS    *float64 `json:"avg_ms"`
	P99MS    *float64 `json:"p99_ms"`
}

const (
	publicWindow = 24 * time.Hour
	publicBucket = 30 * time.Minute
	publicTTL    = time.Minute // the landing page is public: serve every visitor from one cached result
)

var publicCache struct {
	sync.Mutex
	at  time.Time
	val *PublicStats
}

// PublicStats returns cached platform-wide aggregates (refreshed at most once a minute).
func (s *Store) PublicStats(ctx context.Context) (*PublicStats, error) {
	publicCache.Lock()
	defer publicCache.Unlock()

	if publicCache.val != nil && time.Since(publicCache.at) < publicTTL {
		return publicCache.val, nil
	}

	v, err := s.computePublicStats(ctx)
	if err != nil {
		if publicCache.val != nil { // serve the last good result rather than failing the landing page
			return publicCache.val, nil
		}

		return nil, err
	}

	publicCache.val, publicCache.at = v, time.Now()

	return v, nil
}

func (s *Store) computePublicStats(ctx context.Context) (*PublicStats, error) {
	now := time.Now().UTC().Truncate(time.Minute)
	n := int(publicWindow / publicBucket)
	from := now.Add(-time.Duration(n) * publicBucket)
	step := publicBucket.Seconds()

	out := &PublicStats{
		WindowHours:      int(publicWindow.Hours()),
		BucketMinutes:    int(publicBucket.Minutes()),
		Series:           make([]PublicBucket, n),
		SourceTypesInUse: []string{},
		GeneratedAt:      now.Format(time.RFC3339),
	}

	for i := range out.Series {
		out.Series[i].Time = from.Add(time.Duration(i) * publicBucket).Format(time.RFC3339)
	}

	var (
		wg   sync.WaitGroup
		errs [4]error
		mu   sync.Mutex // guards out.Series, written by two queries
	)

	wg.Add(4)

	// requests per bucket
	go func() {
		defer wg.Done()

		rows, err := s.db.QueryContext(ctx, `SELECT floor(extract(epoch FROM ingested_at - $1::timestamptz) / $2)::int, count(*)
			FROM requests WHERE ingested_at >= $1::timestamptz GROUP BY 1`, from, step)
		if err != nil {
			errs[0] = err
			return
		}
		defer rows.Close()

		for rows.Next() {
			var b, c int
			if errs[0] = rows.Scan(&b, &c); errs[0] != nil {
				return
			}

			if b >= 0 && b < n {
				mu.Lock()
				out.Series[b].Requests = c
				mu.Unlock()
			}
		}

		errs[0] = rows.Err()
	}()

	// end-to-end latency per bucket, plus the whole window (the NULL-bucket grouping-set row)
	go func() {
		defer wg.Done()

		rows, err := s.db.QueryContext(ctx, `SELECT b, avg(ms), percentile_cont(0.99) WITHIN GROUP (ORDER BY ms)
			FROM (SELECT floor(extract(epoch FROM a.created_at - $1::timestamptz) / $2)::int AS b,
			             extract(epoch FROM a.created_at - r.ingested_at) * 1000 AS ms
			      FROM attempts a JOIN events e ON e.id = a.event_id JOIN requests r ON r.id = e.request_id
			      WHERE a.trigger = 'INITIAL' AND a.created_at >= $1::timestamptz) x
			GROUP BY GROUPING SETS ((b), ())`, from, step)
		if err != nil {
			errs[1] = err
			return
		}
		defer rows.Close()

		for rows.Next() {
			var (
				b        *int
				avg, p99 sql.NullFloat64
			)

			if errs[1] = rows.Scan(&b, &avg, &p99); errs[1] != nil {
				return
			}

			if !avg.Valid || !p99.Valid { // the whole-window row of an empty window
				continue
			}

			a, p := round1(avg.Float64), round1(p99.Float64)

			mu.Lock()
			if b == nil {
				out.AvgLatencyMS, out.P99LatencyMS = &a, &p
			} else if *b >= 0 && *b < n {
				out.Series[*b].AvgMS, out.Series[*b].P99MS = &a, &p
			}
			mu.Unlock()
		}

		errs[1] = rows.Err()
	}()

	// headline counters
	go func() {
		defer wg.Done()

		var ok, failed int

		errs[2] = s.db.QueryRowContext(ctx, `SELECT
			(SELECT count(*) FROM requests WHERE ingested_at > now() - interval '24 hours'),
			(SELECT count(*) FROM requests WHERE ingested_at > now() - interval '15 minutes'),
			(SELECT count(*) FROM requests),
			(SELECT count(DISTINCT source_id) FROM requests),
			(SELECT count(*) FILTER (WHERE status = 'SUCCESSFUL') FROM events),
			(SELECT count(*) FILTER (WHERE status = 'FAILED') FROM events)`).
			Scan(&out.Requests24h, &out.RequestsLast15m, &out.RequestsTotal, &out.DistinctSources, &ok, &failed)

		out.EventsDelivered = ok
		if ok+failed > 0 {
			r := round1(float64(ok) * 100 / float64(ok+failed))
			out.DeliverySuccess = &r
		}
	}()

	// which source types are carrying traffic
	go func() {
		defer wg.Done()

		rows, err := s.db.QueryContext(ctx, `SELECT s.type FROM requests r JOIN sources s ON s.id = r.source_id
			WHERE r.ingested_at > now() - interval '30 days' GROUP BY s.type ORDER BY count(*) DESC LIMIT 12`)
		if err != nil {
			errs[3] = err
			return
		}
		defer rows.Close()

		var types []string

		for rows.Next() {
			var t string
			if errs[3] = rows.Scan(&t); errs[3] != nil {
				return
			}

			types = append(types, t)
		}

		mu.Lock()
		out.SourceTypesInUse = append(out.SourceTypesInUse, types...)
		mu.Unlock()

		errs[3] = rows.Err()
	}()

	wg.Wait()

	if err := errors.Join(errs[:]...); err != nil {
		return nil, err
	}

	return out, nil
}

func round1(f float64) float64 { return float64(int64(f*10+0.5)) / 10 }
