package delivery

import (
	"sync"
	"time"
)

// rateLimiter is an in-memory per-destination token bucket.
// Fine for a single instance; move to Postgres/Redis when running several workers.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newRateLimiter() *rateLimiter { return &rateLimiter{buckets: map[string]*bucket{}} }

func periodDuration(p string) time.Duration {
	switch p {
	case "minute":
		return time.Minute
	case "hour":
		return time.Hour
	}

	return time.Second
}

// reserve takes a token, or returns how long to wait for one.
func (r *rateLimiter) reserve(key string, limit int, period string) time.Duration {
	r.mu.Lock()
	defer r.mu.Unlock()

	rate := float64(limit) / periodDuration(period).Seconds() // tokens per second
	now := time.Now()

	b := r.buckets[key]
	if b == nil {
		b = &bucket{tokens: float64(limit), last: now}
		r.buckets[key] = b
	}

	b.tokens = min(float64(limit), b.tokens+now.Sub(b.last).Seconds()*rate)
	b.last = now

	if b.tokens >= 1 {
		b.tokens--
		return 0
	}

	return time.Duration((1 - b.tokens) / rate * float64(time.Second))
}
