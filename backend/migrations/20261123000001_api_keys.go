package migrations

import "gofr.dev/pkg/gofr/migration"

// API keys: long-lived credentials for the hosted MCP endpoint and scripts. Each key belongs to a
// user and one workspace; only a SHA-256 hash of the secret is stored.
const apiKeysSchema = `
CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS api_keys_owner ON api_keys (user_id, workspace_id);
`

func createAPIKeys() migration.Migrate {
	return migration.Migrate{
		UP: func(d migration.Datasource) error {
			_, err := d.SQL.Exec(apiKeysSchema)
			return err
		},
	}
}
