package delivery

import (
	"context"
	"database/sql"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/zopping/easewebhook/backend/internal/store"
)

// failingDB fails every query, like a database rejecting our password.
type failingDB struct{ calls atomic.Int32 }

func (f *failingDB) QueryContext(context.Context, string, ...any) (*sql.Rows, error) {
	f.calls.Add(1)
	return nil, errors.New("password authentication failed")
}
func (f *failingDB) QueryRowContext(context.Context, string, ...any) *sql.Row { return nil }
func (f *failingDB) ExecContext(context.Context, string, ...any) (sql.Result, error) {
	return nil, errors.New("password authentication failed")
}

type quietLog struct{}

func (quietLog) Errorf(string, ...any) {}
func (quietLog) Infof(string, ...any)  {}
func (quietLog) Debugf(string, ...any) {}

func TestWorkerBacksOffWhileDatabaseFails(t *testing.T) {
	db := &failingDB{}
	w := NewWorker(store.New(db), quietLog{}, Config{PollInterval: 100 * time.Millisecond})

	ctx, cancel := context.WithTimeout(context.Background(), 3500*time.Millisecond)
	defer cancel()
	w.Run(ctx)

	// Without backoff a 100ms poll makes ~35 attempts in 3.5s; with 1s, 2s, 4s... backoff it's 2-3.
	if n := db.calls.Load(); n > 4 {
		t.Fatalf("worker hammered a failing database: %d attempts in 3.5s", n)
	}
}
