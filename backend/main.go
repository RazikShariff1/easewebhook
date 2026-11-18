// EaseWebhook: a webhook gateway (ingest -> route -> transform -> deliver with retries), built on GoFr.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"gofr.dev/pkg/gofr"
	gofrsql "gofr.dev/pkg/gofr/datasource/sql"

	"github.com/zopping/easewebhook/backend/internal/auth"
	"github.com/zopping/easewebhook/backend/internal/delivery"
	"github.com/zopping/easewebhook/backend/internal/handlers"
	"github.com/zopping/easewebhook/backend/internal/ingest"
	"github.com/zopping/easewebhook/backend/internal/store"
	"github.com/zopping/easewebhook/backend/migrations"
)

func main() {
	app := gofr.New()

	app.Migrate(migrations.All())

	if base := app.Config.Get("PUBLIC_INGEST_BASE_URL"); base != "" {
		store.IngestBaseURL = base
	}

	var (
		st     atomic.Pointer[store.Store]
		worker atomic.Pointer[delivery.Worker]
	)

	notify := func() {
		if w := worker.Load(); w != nil {
			w.Notify()
		}
	}

	ingestHandler := &ingest.Handler{Store: st.Load, Log: app.Logger(), OnSent: notify}
	app.UseMiddleware(ingestHandler.Middleware)
	app.UseMiddleware(ingest.MockMiddleware)

	store.MockDestinationURL = mockURL(app)

	authSvc := &auth.Service{
		Secret:         jwtSecret(app),
		GoogleClientID: app.Config.Get("GOOGLE_CLIENT_ID"),
		MockURL:        mockURL(app),
		MemberRole: func(ctx context.Context, ws, uid string) (string, error) {
			s := st.Load()
			if s == nil {
				return "", errors.New("not ready")
			}

			return s.MemberRole(ctx, ws, uid)
		},
		Onboard: func(ctx context.Context, uid, email, name string) error {
			s := st.Load()
			if s == nil {
				return errors.New("not ready")
			}

			return s.OnboardUser(ctx, uid, email, name)
		},
	}
	app.UseMiddleware(authSvc.Middleware)
	authSvc.Register(app)

	(&handlers.API{Notify: notify, Log: app.Logger()}).Register(app)

	app.OnStart(func(c *gofr.Context) error {
		// Without a database every request and the delivery worker would fail; stop with a clear message
		// instead of crash-looping on a nil connection.
		if c.SQL == nil {
			return errors.New("database is not configured: set DB_DIALECT=postgres, DB_HOST, DB_PORT, DB_USER, " +
				"DB_PASSWORD, DB_NAME and DB_SSL_MODE (see backend/configs/.env.example or render.yaml)")
		}

		// The store gets its own pool tuned for a remote database (one round trip per query, warm idle
		// connections); GoFr's connection keeps running migrations and the health check.
		pool, err := store.OpenPool(context.Background(), store.PoolConfig{
			Host:     app.Config.Get("DB_HOST"),
			Port:     app.Config.GetOrDefault("DB_PORT", "5432"),
			User:     app.Config.Get("DB_USER"),
			Password: app.Config.Get("DB_PASSWORD"),
			Name:     app.Config.Get("DB_NAME"),
			SSLMode:  app.Config.GetOrDefault("DB_SSL_MODE", "require"),
			MaxOpen:  intConf(app, "DB_MAX_OPEN_CONNECTION", 5),
		})
		if err != nil {
			return fmt.Errorf("opening database pool: %w", err)
		}

		// Supabase's session pooler allows only 15 client connections in total (production + local dev).
		// GoFr's own pool now only serves migrations and the health check, so keep it to one connection.
		if g, ok := c.SQL.(*gofrsql.DB); ok {
			g.SetMaxOpenConns(1)
			g.SetMaxIdleConns(1)
		}

		handlers.UseDB(pool)
		authSvc.Pool = pool

		s := store.New(pool)
		st.Store(s)

		w := delivery.NewWorker(s, app.Logger(), delivery.Config{
			Concurrency:  intConf(app, "WORKER_CONCURRENCY", 10),
			BatchSize:    intConf(app, "WORKER_BATCH_SIZE", 20),
			PollInterval: time.Duration(intConf(app, "WORKER_POLL_INTERVAL_MS", 500)) * time.Millisecond,
			Timeout:      time.Duration(intConf(app, "DELIVERY_TIMEOUT_SECONDS", 30)) * time.Second,
		})
		worker.Store(w)

		ctx, _ := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
		go w.Run(ctx)

		return nil
	})

	app.Run()
}

// jwtSecret reads JWT_SECRET; without it sessions use a random key and end on every restart.
func jwtSecret(app *gofr.App) []byte {
	if s := app.Config.Get("JWT_SECRET"); len(s) >= 32 {
		return []byte(s)
	}

	app.Logger().Warn("JWT_SECRET is missing or shorter than 32 chars; using a random key (sessions reset on restart)")

	b := make([]byte, 32)
	_, _ = rand.Read(b)

	return b
}

// mockURL is where the built-in Mock API destination is reachable (MOCK_DESTINATION_URL,
// else derived from PUBLIC_INGEST_BASE_URL by swapping its trailing /e for /mock).
func mockURL(app *gofr.App) string {
	if u := app.Config.Get("MOCK_DESTINATION_URL"); u != "" {
		return u
	}

	base := strings.TrimSuffix(strings.TrimRight(store.IngestBaseURL, "/"), "/e")

	return base + ingest.MockPath
}

func intConf(app *gofr.App, key string, def int) int {
	if v, err := strconv.Atoi(app.Config.Get(key)); err == nil && v > 0 {
		return v
	}

	return def
}
