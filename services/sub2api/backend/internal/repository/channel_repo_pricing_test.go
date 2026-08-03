package repository

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestScanModelPricingRowsAllowsNullUpstreamMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	createdAt := time.Now().UTC()
	updatedAt := createdAt.Add(time.Minute)
	mock.ExpectQuery("SELECT id").WillReturnRows(sqlmock.NewRows([]string{
		"id", "channel_id", "platform", "models", "billing_mode",
		"input_price", "output_price", "cache_write_price", "cache_read_price",
		"image_input_price", "image_output_price", "per_request_price",
		"upstream_cost_multiplier", "upstream_pricing_group", "upstream_pricing_version",
		"created_at", "updated_at",
	}).AddRow(
		int64(11), int64(22), "openai", []byte("[\"gpt-4o\"]"), "token",
		0.1, 0.2, nil, nil, nil, nil, nil, nil, nil, nil,
		createdAt, updatedAt,
	))

	rows, err := db.Query("SELECT id, channel_id, platform, models, billing_mode")
	require.NoError(t, err)
	pricing, ids, err := scanModelPricingRows(rows)
	require.NoError(t, err)
	require.NoError(t, rows.Err())
	require.NoError(t, mock.ExpectationsWereMet())

	require.Equal(t, []int64{11}, ids)
	require.Len(t, pricing, 1)
	require.Equal(t, int64(22), pricing[0].ChannelID)
	require.Equal(t, []string{"gpt-4o"}, pricing[0].Models)
	require.Empty(t, pricing[0].UpstreamPricingGroup)
	require.Empty(t, pricing[0].UpstreamPricingVersion)
	require.Nil(t, pricing[0].UpstreamCostMultiplier)
}
