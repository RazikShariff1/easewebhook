package migrations

import "gofr.dev/pkg/gofr/migration"

// Sources get a type (WEBHOOK, PUBLISH_API, HTTP, STRIPE, GITHUB, ...) and per-type config (secrets, keys).
const sourceTypesSchema = `
ALTER TABLE sources ADD COLUMN IF NOT EXISTS type   TEXT  NOT NULL DEFAULT 'WEBHOOK';
ALTER TABLE sources ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
`

func addSourceTypes() migration.Migrate {
	return migration.Migrate{
		UP: func(d migration.Datasource) error {
			_, err := d.SQL.Exec(sourceTypesSchema)
			return err
		},
	}
}
