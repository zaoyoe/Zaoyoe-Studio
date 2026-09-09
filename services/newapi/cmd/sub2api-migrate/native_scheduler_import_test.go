package main

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNativeSchedulerImportFlagIsExplicitAndPlanOnlyIsMutuallyExclusive(t *testing.T) {
	for _, value := range []string{"1", "true", "TRUE", "yes", "on"} {
		assert.True(t, isNativeSchedulerImport(value), value)
	}
	for _, value := range []string{"", "0", "false", "no", "off", "random"} {
		assert.False(t, isNativeSchedulerImport(value), value)
		assert.False(t, isPreservePartialBridgeState(value), value)
	}
	for _, value := range []string{"1", "true", "TRUE", "yes", "on"} {
		assert.True(t, isPreservePartialBridgeState(value), value)
	}

	t.Setenv("PLAN_ONLY", "true")
	t.Setenv(nativeSchedulerImportEnv, "true")
	t.Setenv("SHADOW_COMPARE", "")
	err := run(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot be enabled together")
}

func TestLoadLegacyNativeSchedulerCredentialsAllowlistDoesNotExposeRefreshToken(t *testing.T) {
	db, mock := newMigrationSQLMock(t)
	mock.ExpectQuery(regexp.QuoteMeta(nativeSchedulerCredentialQuery)).WithArgs("{7,8}").
		WillReturnRows(sqlmock.NewRows([]string{"id", "type", "credentials"}).
			AddRow(7, "apikey", []byte(`{"api_key":"api-secret","refresh_token":"refresh-secret"}`)).
			AddRow(8, "oauth", []byte(`{"api_key":"should-not-import","refresh_token":"refresh-only"}`)))

	credentials, err := loadLegacyNativeSchedulerCredentials(context.Background(), db, []nativeChannelPlan{{SourceAccountID: 7}, {SourceAccountID: 8}})
	require.NoError(t, err)
	require.Len(t, credentials, 1)
	assert.Equal(t, int64(7), credentials[7].AccountID)
	assert.Equal(t, "apikey", credentials[7].AuthType)
	assert.Equal(t, "api-secret", credentials[7].Key)
	assert.NotContains(t, credentials, int64(8))
	require.NoError(t, mock.ExpectationsWereMet())
}

func nativeSchedulerImportTestPlan() nativeSchedulerPlan {
	return nativeSchedulerPlan{
		Version: nativeSchedulerPlanVersion,
		Channels: []nativeChannelPlan{{
			SourceAccountID: 7,
			Name:            "NewAPI native - account-7",
			Type:            constant.ChannelTypeOpenAI,
			TypeName:        constant.GetChannelTypeName(constant.ChannelTypeOpenAI),
			AuthType:        "apikey",
			KeyRef:          "legacy-account:7:credential",
			BaseURL:         "https://upstream.test/v1",
			Models:          []string{"model-a", "model-b"},
			Groups:          []string{"default"},
			ModelMapping:    map[string]string{"alias": "model-a"},
			Status:          common.ChannelStatusEnabled,
			Priority:        12,
			Weight:          3,
			Setting:         map[string]any{"legacy_account_id": int64(7)},
		}},
		Report: nativeSchedulerPlanReport{Skipped: 1},
	}
}

func nativeSchedulerImportTestCredentials() map[int64]nativeSchedulerImportCredential {
	return map[int64]nativeSchedulerImportCredential{
		7: {AccountID: 7, AuthType: "apikey", Key: "api-secret"},
	}
}

func expectNativeSchedulerChannelInsert(t *testing.T, mock sqlmock.Sqlmock, plan nativeSchedulerPlan, channelID int) {
	t.Helper()
	channel := plan.Channels[0]
	tag := nativeSchedulerChannelTag(channel.SourceAccountID)
	mock.ExpectQuery(`INSERT INTO channels`).
		WithArgs(
			channel.Type,
			"api-secret",
			channel.Status,
			channel.Name,
			int64(channel.Weight),
			sqlmock.AnyArg(),
			channel.BaseURL,
			"model-a,model-b",
			"default",
			`{"alias":"model-a"}`,
			channel.Priority,
			tag,
			`{"legacy_account_id":7}`,
		).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(channelID))
}

func expectNativeSchedulerAbilities(t *testing.T, mock sqlmock.Sqlmock, channelID int) {
	t.Helper()
	tag := nativeSchedulerChannelTag(7)
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM abilities WHERE channel_id = $1`)).
		WithArgs(channelID).
		WillReturnResult(sqlmock.NewResult(0, 2))
	for _, model := range []string{"model-a", "model-b"} {
		mock.ExpectExec(`INSERT INTO abilities`).
			WithArgs("default", model, channelID, true, int64(12), uint(3), tag).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}
}

func expectNativeSchedulerImportPreamble(mock sqlmock.Sqlmock, tag string, channelID ...int) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta(nativeSchedulerImportLockQuery)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	rows := sqlmock.NewRows([]string{"id", "type"})
	for _, id := range channelID {
		rows.AddRow(id, constant.ChannelTypeOpenAI)
	}
	mock.ExpectQuery(regexp.QuoteMeta(nativeSchedulerManagedChannelSQL)).
		WithArgs(tag).
		WillReturnRows(rows)
}

func TestImportNativeSchedulerPlanCreatesChannelAndAbilitiesAtomically(t *testing.T) {
	target, mock := newMigrationSQLMock(t)
	plan := nativeSchedulerImportTestPlan()
	expectNativeSchedulerImportPreamble(mock, nativeSchedulerChannelTag(7))
	expectNativeSchedulerChannelInsert(t, mock, plan, 101)
	expectNativeSchedulerAbilities(t, mock, 101)
	mock.ExpectCommit()

	report, err := importNativeSchedulerPlan(context.Background(), target, plan, nativeSchedulerImportTestCredentials())
	require.NoError(t, err)
	assert.Equal(t, nativeSchedulerImportReport{
		ImportedChannels: 1,
		CreatedChannels:  1,
		Abilities:        2,
		Skipped:          1,
	}, report)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestImportNativeSchedulerPlanUpdatesExistingChannelIdempotently(t *testing.T) {
	target, mock := newMigrationSQLMock(t)
	plan := nativeSchedulerImportTestPlan()
	tag := nativeSchedulerChannelTag(7)
	expectNativeSchedulerImportPreamble(mock, tag, 101)
	mock.ExpectExec(`UPDATE channels`).
		WithArgs(
			constant.ChannelTypeOpenAI,
			"api-secret",
			common.ChannelStatusEnabled,
			"NewAPI native - account-7",
			int64(3),
			plan.Channels[0].BaseURL,
			"model-a,model-b",
			"default",
			`{"alias":"model-a"}`,
			int64(12),
			tag,
			`{"legacy_account_id":7}`,
			101,
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectNativeSchedulerAbilities(t, mock, 101)
	mock.ExpectCommit()

	report, err := importNativeSchedulerPlan(context.Background(), target, plan, nativeSchedulerImportTestCredentials())
	require.NoError(t, err)
	assert.Equal(t, 1, report.UpdatedChannels)
	assert.Equal(t, 0, report.CreatedChannels)
	assert.Equal(t, 2, report.Abilities)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestImportNativeSchedulerPlanRollsBackOnAbilityFailure(t *testing.T) {
	target, mock := newMigrationSQLMock(t)
	plan := nativeSchedulerImportTestPlan()
	expectNativeSchedulerImportPreamble(mock, nativeSchedulerChannelTag(7))
	expectNativeSchedulerChannelInsert(t, mock, plan, 101)
	mock.ExpectExec(regexp.QuoteMeta(`DELETE FROM abilities WHERE channel_id = $1`)).
		WithArgs(101).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`INSERT INTO abilities`).
		WithArgs("default", "model-a", 101, true, int64(12), uint(3), nativeSchedulerChannelTag(7)).
		WillReturnError(sql.ErrTxDone)
	mock.ExpectRollback()

	_, err := importNativeSchedulerPlan(context.Background(), target, plan, nativeSchedulerImportTestCredentials())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "insert native scheduler ability")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestImportNativeSchedulerPlanRevalidatesModelMappingAndBaseURL(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*nativeChannelPlan)
		want   string
	}{
		{
			name: "wildcard mapping",
			mutate: func(channel *nativeChannelPlan) {
				channel.ModelMapping = map[string]string{"model-*": "upstream"}
			},
			want: "unsupported wildcard",
		},
		{
			name: "query base URL",
			mutate: func(channel *nativeChannelPlan) {
				channel.BaseURL = "https://upstream.test/v1?tenant=public"
			},
			want: "must not include a query",
		},
		{
			name: "userinfo base URL",
			mutate: func(channel *nativeChannelPlan) {
				channel.BaseURL = "https://user:password@upstream.test/v1"
			},
			want: "must not include userinfo",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			target, mock := newMigrationSQLMock(t)
			plan := nativeSchedulerImportTestPlan()
			test.mutate(&plan.Channels[0])
			_, err := importNativeSchedulerPlan(context.Background(), target, plan, nativeSchedulerImportTestCredentials())
			require.Error(t, err)
			assert.Contains(t, err.Error(), test.want)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
