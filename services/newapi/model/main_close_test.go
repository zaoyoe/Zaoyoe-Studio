package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestCloseDBAllowsUninitializedLogDatabase(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:close-db-main-only?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)

	previousDB, previousLogDB := DB, LOG_DB
	DB, LOG_DB = db, nil
	t.Cleanup(func() {
		DB, LOG_DB = previousDB, previousLogDB
	})

	var closeErr error
	assert.NotPanics(t, func() {
		closeErr = CloseDB()
	})
	require.NoError(t, closeErr)

	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.Error(t, sqlDB.Ping())
}
