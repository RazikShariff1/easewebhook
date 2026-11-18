package migrations

import "gofr.dev/pkg/gofr/migration"

// Destinations get a type: HTTP (any URL), MOCK_API (built-in /mock endpoint) or CLI (reserved, not yet available).
const destinationTypesSchema = `
ALTER TABLE destinations ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'HTTP';
UPDATE destinations SET type = 'MOCK_API' WHERE type = 'HTTP' AND (url LIKE '%/mock' OR url LIKE '%/mock/%');
`

func addDestinationTypes() migration.Migrate {
	return migration.Migrate{
		UP: func(d migration.Datasource) error {
			_, err := d.SQL.Exec(destinationTypesSchema)
			return err
		},
	}
}
