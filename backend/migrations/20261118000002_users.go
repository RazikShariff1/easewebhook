package migrations

import "gofr.dev/pkg/gofr/migration"

const usersSchema = `
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    avatar_url    TEXT,
    password_hash TEXT,
    google_sub    TEXT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);
`

func createUsers() migration.Migrate {
	return migration.Migrate{
		UP: func(d migration.Datasource) error {
			_, err := d.SQL.Exec(usersSchema)
			return err
		},
	}
}
