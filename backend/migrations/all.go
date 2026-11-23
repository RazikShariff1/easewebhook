// Package migrations holds the database schema migrations, run on startup by GoFr.
package migrations

import "gofr.dev/pkg/gofr/migration"

func All() map[int64]migration.Migrate {
	return map[int64]migration.Migrate{
		20261118000001: createInitialSchema(),
		20261118000002: createUsers(),
		20261118000003: createWorkspaces(),
		20261118000004: addSourceTypes(),
		20261118000005: addDestinationTypes(),
		20261123000001: createAPIKeys(),
	}
}
