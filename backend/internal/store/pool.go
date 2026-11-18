package store

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	_ "github.com/lib/pq" // postgres driver
)

// PoolConfig describes the connection pool the store uses for API and worker queries.
type PoolConfig struct {
	Host, Port, User, Password, Name, SSLMode string
	MaxOpen                                   int
}

// OpenPool opens a Postgres pool tuned for a remote database (e.g. Supabase over the internet):
//
//   - binary_parameters=yes makes lib/pq send a parameterised query as one round trip
//     (Parse+Bind+Execute together) instead of two. Every query argument in this package is a
//     string, number, bool or time, never []byte, so binary mode doesn't change how values are encoded.
//   - idle connections equal open connections, so a burst of parallel API calls (a page load fires
//     several) reuses warm connections instead of closing and reopening them; a new TLS + pooler
//     login costs ~8 round trips. Keep MaxOpen small: the pooler's client limit is shared.
func OpenPool(ctx context.Context, c PoolConfig) (*sql.DB, error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s binary_parameters=yes connect_timeout=10",
		quote(c.Host), quote(c.Port), quote(c.User), quote(c.Password), quote(c.Name), quote(c.SSLMode))

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}

	if c.MaxOpen <= 0 {
		c.MaxOpen = 5
	}

	db.SetMaxOpenConns(c.MaxOpen)
	db.SetMaxIdleConns(c.MaxOpen)
	// Release connections idle for a few minutes: the pooler's client limit is shared by every
	// instance (Supabase session mode: 15), so an idle server shouldn't sit on its whole pool.
	db.SetConnMaxIdleTime(3 * time.Minute)
	db.SetConnMaxLifetime(time.Hour)

	pctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	if err := db.PingContext(pctx); err != nil {
		_ = db.Close()
		return nil, err
	}

	return db, nil
}

// quote escapes a libpq connection-string value.
func quote(v string) string {
	if v == "" {
		return "''"
	}

	return "'" + strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(v) + "'"
}
