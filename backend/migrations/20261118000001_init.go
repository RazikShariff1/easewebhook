package migrations

import "gofr.dev/pkg/gofr/migration"

const initSchema = `
CREATE TABLE IF NOT EXISTS sources (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    key           TEXT NOT NULL UNIQUE,
    description   TEXT,
    allowed_methods TEXT NOT NULL DEFAULT 'POST,PUT,PATCH,DELETE,GET',
    verification  JSONB,
    custom_response JSONB,
    disabled_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS destinations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    description   TEXT,
    url           TEXT NOT NULL,
    http_method   TEXT,
    auth_type     TEXT NOT NULL DEFAULT 'NONE',
    auth          JSONB,
    rate_limit    INTEGER,
    rate_limit_period TEXT NOT NULL DEFAULT 'second',
    path_forwarding BOOLEAN NOT NULL DEFAULT true,
    disabled_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transformations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    code          TEXT NOT NULL,
    env           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    destination_id  TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
    rules           JSONB NOT NULL DEFAULT '[]'::jsonb,
    paused_at       TIMESTAMPTZ,
    disabled_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_id, name)
);
CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_id);
CREATE INDEX IF NOT EXISTS idx_connections_destination ON connections(destination_id);

CREATE TABLE IF NOT EXISTS requests (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    method          TEXT NOT NULL,
    path            TEXT NOT NULL DEFAULT '',
    query           TEXT NOT NULL DEFAULT '',
    headers         JSONB NOT NULL DEFAULT '{}'::jsonb,
    body            TEXT,
    body_json       JSONB,
    content_type    TEXT,
    verified        BOOLEAN,
    status          TEXT NOT NULL DEFAULT 'ACCEPTED',
    rejection_cause TEXT,
    events_count    INTEGER NOT NULL DEFAULT 0,
    ignored_count   INTEGER NOT NULL DEFAULT 0,
    original_ip     TEXT,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_requests_source_time ON requests(source_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_time ON requests(ingested_at DESC);

CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    request_id      TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    connection_id   TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    source_id       TEXT NOT NULL,
    destination_id  TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'QUEUED',
    method          TEXT NOT NULL,
    path            TEXT NOT NULL DEFAULT '',
    query           TEXT NOT NULL DEFAULT '',
    headers         JSONB NOT NULL DEFAULT '{}'::jsonb,
    body            TEXT,
    body_json       JSONB,
    attempts        INTEGER NOT NULL DEFAULT 0,
    response_status INTEGER,
    error_code      TEXT,
    last_attempt_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ,
    successful_at   TIMESTAMPTZ,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_due ON events(next_attempt_at) WHERE status IN ('QUEUED','SCHEDULED');
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_connection_time ON events(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_status_time ON events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_request ON events(request_id);

CREATE TABLE IF NOT EXISTS attempts (
    id               TEXT PRIMARY KEY,
    event_id         TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    attempt_number   INTEGER NOT NULL,
    trigger          TEXT NOT NULL DEFAULT 'INITIAL',
    status           TEXT NOT NULL,
    requested_url    TEXT NOT NULL,
    http_method      TEXT NOT NULL,
    request_headers  JSONB,
    response_status  INTEGER,
    response_headers JSONB,
    response_body    TEXT,
    error_code       TEXT,
    error_message    TEXT,
    duration_ms      INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attempts_event ON attempts(event_id, attempt_number DESC);
`

func createInitialSchema() migration.Migrate {
	return migration.Migrate{
		UP: func(d migration.Datasource) error {
			_, err := d.SQL.Exec(initSchema)
			return err
		},
	}
}
