package migrations

import "gofr.dev/pkg/gofr/migration"

// Data created before workspaces existed moves into a "Default" workspace (ws_default).
// It is adopted by existing users now, or by the first user to sign up if there are none.
const workspacesSchema = `
CREATE TABLE IF NOT EXISTS workspaces (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS workspace_invites (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'member',
    invited_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, email)
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON workspace_invites(email);

INSERT INTO workspaces (id, name)
SELECT 'ws_default', 'Default'
WHERE EXISTS (SELECT 1 FROM sources) OR EXISTS (SELECT 1 FROM destinations) OR EXISTS (SELECT 1 FROM transformations)
ON CONFLICT DO NOTHING;

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT 'ws_default', u.id, 'owner' FROM users u WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = 'ws_default')
ON CONFLICT DO NOTHING;

ALTER TABLE sources         ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE destinations    ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE transformations ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE connections     ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE requests        ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE events          ADD COLUMN IF NOT EXISTS workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE;

UPDATE sources         SET workspace_id = 'ws_default' WHERE workspace_id IS NULL;
UPDATE destinations    SET workspace_id = 'ws_default' WHERE workspace_id IS NULL;
UPDATE transformations SET workspace_id = 'ws_default' WHERE workspace_id IS NULL;
UPDATE connections     SET workspace_id = 'ws_default' WHERE workspace_id IS NULL;
UPDATE requests        SET workspace_id = 'ws_default' WHERE workspace_id IS NULL;
UPDATE events          SET workspace_id = 'ws_default' WHERE workspace_id IS NULL;

ALTER TABLE sources         ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE destinations    ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE transformations ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE connections     ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE requests        ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE events          ALTER COLUMN workspace_id SET NOT NULL;

-- names are unique per workspace instead of globally
ALTER TABLE sources         DROP CONSTRAINT IF EXISTS sources_name_key;
ALTER TABLE destinations    DROP CONSTRAINT IF EXISTS destinations_name_key;
ALTER TABLE transformations DROP CONSTRAINT IF EXISTS transformations_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sources_ws_name         ON sources(workspace_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_destinations_ws_name    ON destinations(workspace_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_transformations_ws_name ON transformations(workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_connections_ws ON connections(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_ws_time ON requests(workspace_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_ws_time ON events(workspace_id, created_at DESC);
`

func createWorkspaces() migration.Migrate {
	return migration.Migrate{
		UP: func(d migration.Datasource) error {
			_, err := d.SQL.Exec(workspacesSchema)
			return err
		},
	}
}
