package main

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseNativeSchedulerGroupIDsNormalizesAndSorts(t *testing.T) {
	ids, err := parseNativeSchedulerGroupIDs(" 9,2,9, 11 ")
	require.NoError(t, err)
	assert.Equal(t, []int64{2, 9, 11}, ids)

	ids, err = parseNativeSchedulerGroupIDs("")
	require.NoError(t, err)
	assert.Nil(t, ids)

	for _, raw := range []string{"0", "-1", "abc", "1,"} {
		_, err := parseNativeSchedulerGroupIDs(raw)
		require.Error(t, err, raw)
		assert.Contains(t, err.Error(), nativeSchedulerGroupEnv)
	}
}

func TestPostgresInt64ArrayValueIsValidatedAndDeterministic(t *testing.T) {
	value, err := postgresInt64Array{9, 2, 11}.Value()
	require.NoError(t, err)
	assert.Equal(t, "{9,2,11}", value)
	value, err = postgresInt64Array(nil).Value()
	require.NoError(t, err)
	assert.Equal(t, "{}", value)
	_, err = postgresInt64Array{1, 0}.Value()
	require.Error(t, err)
}

func TestParseBridgeGroupTagRejectsLookalikes(t *testing.T) {
	valid, ok := parseBridgeGroupTag(bridgeChannelTagPrefix + "42")
	assert.True(t, ok)
	assert.Equal(t, int64(42), valid)

	for _, tag := range []string{
		"other:42",
		bridgeChannelTagPrefix,
		bridgeChannelTagPrefix + "0",
		bridgeChannelTagPrefix + "-1",
		bridgeChannelTagPrefix + "42-extra",
	} {
		_, ok := parseBridgeGroupTag(tag)
		assert.False(t, ok, tag)
	}
}

func TestLegacyPlatformChannelTypeMapsVerifiedAliasesOnly(t *testing.T) {
	tests := []struct {
		platform string
		want     int
	}{
		{"openai", constant.ChannelTypeOpenAI},
		{" OPENAI ", constant.ChannelTypeOpenAI},
		{"anthropic", constant.ChannelTypeAnthropic},
		{"claude", constant.ChannelTypeAnthropic},
		{"gemini", constant.ChannelTypeGemini},
		{"grok", constant.ChannelTypeXai},
		{"xai", constant.ChannelTypeXai},
	}
	for _, test := range tests {
		got, err := legacyPlatformChannelType(test.platform)
		require.NoError(t, err, test.platform)
		assert.Equal(t, test.want, got, test.platform)
	}

	for _, platform := range []string{"", "jimeng", "sub2api", "unknown"} {
		_, err := legacyPlatformChannelType(platform)
		require.Error(t, err, platform)
		assert.Contains(t, err.Error(), "no verified native NewAPI channel mapping")
	}
}

func TestLegacyPlanBaseURLRemovesUserinfoAndTrailingSlash(t *testing.T) {
	got, err := legacyPlanBaseURL(map[string]any{
		"base_url": "https://user:password@example.test/v1/",
	})
	require.NoError(t, err)
	assert.Equal(t, "https://example.test/v1", got)
	assert.NotContains(t, got, "password")

	for _, raw := range []string{
		"example.test/v1",
		"ftp://example.test/v1",
		"https:///v1",
		"https://example.test/%zz",
	} {
		_, err := legacyPlanBaseURL(map[string]any{"base_url": raw})
		require.Error(t, err, raw)
	}
}

func TestLegacyPlanBaseURLRejectsQueryAndFragment(t *testing.T) {
	for _, raw := range []string{
		"https://example.test/v1?api_key=query-secret",
		"https://example.test/v1?tenant=public&version=1",
		"https://example.test/v1?",
		"https://example.test/v1#fragment",
	} {
		_, err := legacyPlanBaseURL(map[string]any{"base_url": raw})
		require.Error(t, err, raw)
		assert.NotContains(t, err.Error(), "query-secret")
	}
}

func TestSnapshotLegacyAccountOnlyMarksNativeAPIKeysAsPresent(t *testing.T) {
	baseArgs := func(credentials map[string]any, authType string) legacyAccountPlanSnapshot {
		snapshot, err := snapshotLegacyAccount(
			9, "account", "openai", authType, credentials, map[string]any{},
			sql.NullInt64{}, sql.NullInt64{}, sql.NullInt64{}, sql.NullInt64{},
			sql.NullFloat64{}, "active", sql.NullString{}, sql.NullTime{}, sql.NullTime{},
			sql.NullBool{}, sql.NullBool{}, sql.NullTime{}, sql.NullTime{}, sql.NullTime{},
			sql.NullTime{}, sql.NullString{}, sql.NullTime{}, sql.NullTime{}, sql.NullString{},
		)
		require.NoError(t, err)
		return snapshot
	}

	assert.True(t, baseArgs(map[string]any{"api_key": "secret"}, "apikey").CredentialPresent)
	assert.True(t, baseArgs(map[string]any{"key": "secret"}, "upstream").CredentialPresent)
	assert.False(t, baseArgs(map[string]any{"token": "setup-secret"}, "setup-token").CredentialPresent)
	assert.False(t, baseArgs(map[string]any{"refresh_token": "refresh-secret"}, "oauth").CredentialPresent)
}

func TestSnapshotLegacyAccountKeepsMetadataButNeverCredentialValues(t *testing.T) {
	credentials := map[string]any{
		"api_key":       "api-secret-value",
		"access_token":  "access-secret-value",
		"refresh_token": "refresh-secret-value",
		"base_url":      "https://user:password@example.test/v1/",
		"models":        []any{"z-model", "a-model"},
		"model_mapping": map[string]any{"alias": "upstream-model"},
	}
	snapshot, err := snapshotLegacyAccount(
		7,
		"Account 7",
		"openai",
		"apikey",
		credentials,
		map[string]any{"ignored_secret": "must-not-escape"},
		sql.NullInt64{Int64: 3, Valid: true},
		sql.NullInt64{Int64: 10, Valid: true},
		sql.NullInt64{Int64: 2, Valid: true},
		sql.NullInt64{Int64: 20, Valid: true},
		sql.NullFloat64{Float64: 1, Valid: true},
		"active",
		sql.NullString{},
		sql.NullTime{}, sql.NullTime{},
		sql.NullBool{Bool: true, Valid: true},
		sql.NullBool{Bool: true, Valid: true},
		sql.NullTime{}, sql.NullTime{}, sql.NullTime{}, sql.NullTime{},
		sql.NullString{}, sql.NullTime{}, sql.NullTime{}, sql.NullString{},
	)
	require.NoError(t, err)

	raw, err := common.Marshal(snapshot)
	require.NoError(t, err)
	serialized := string(raw)
	for _, secret := range []string{"api-secret-value", "access-secret-value", "refresh-secret-value", "password", "must-not-escape"} {
		assert.NotContains(t, serialized, secret)
	}
	assert.Equal(t, []string{"access_token", "api_key", "base_url", "model_mapping", "models", "refresh_token"}, snapshot.CredentialKeys)
	assert.True(t, snapshot.CredentialPresent)
	assert.Equal(t, "legacy-account:7:credential", snapshot.CredentialRef)
	assert.Equal(t, "https://example.test/v1", snapshot.BaseURL)
	assert.Equal(t, map[string]string{"alias": "upstream-model"}, snapshot.ModelMapping)
	assert.Equal(t, []string{"a-model", "alias", "z-model"}, snapshot.Models)
}

func TestLoadBridgeGroupIDsSortsDeduplicatesAndIgnoresMalformedTags(t *testing.T) {
	db, mock := newMigrationSQLMock(t)
	mock.ExpectQuery(regexp.QuoteMeta(bridgeGroupTagQuery)).
		WithArgs(constant.ChannelTypeSub2API, bridgeChannelTagPrefix+"%").
		WillReturnRows(sqlmock.NewRows([]string{"tag"}).
			AddRow(bridgeChannelTagPrefix + "9").
			AddRow(bridgeChannelTagPrefix + "2").
			AddRow(bridgeChannelTagPrefix + "9").
			AddRow(bridgeChannelTagPrefix + "bad").
			AddRow(nil))

	ids, err := loadBridgeGroupIDs(context.Background(), db)
	require.NoError(t, err)
	assert.Equal(t, []int64{2, 9}, ids)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestLoadLegacyAccountPlanSnapshotsFiltersGroupsAndSortsRows(t *testing.T) {
	db, mock := newMigrationSQLMock(t)
	columns := []string{
		"id", "name", "platform", "type", "credentials", "extra", "proxy_id",
		"concurrency", "load_factor", "priority", "rate_multiplier", "status",
		"error_message", "last_used_at", "expires_at", "auto_pause_on_expired",
		"schedulable", "rate_limited_at", "rate_limit_reset_at", "overload_until",
		"temp_unschedulable_until", "temp_unschedulable_reason", "session_window_start",
		"session_window_end", "session_window_status", "group_id", "group_name",
		"group_status", "group_exclusive", "subscription_type", "group_deleted",
		"group_priority",
	}
	credentials := []byte(`{"api_key":"secret","base_url":"https://upstream.test/v1","models":["model-a"],"model_mapping":{"alias":"model-a"}}`)
	extra := []byte(`{}`)
	rows := sqlmock.NewRows(columns)
	// Account 1 belongs to an unselected group and the selected group. Only
	// the selected group should appear in the native plan.
	rows.AddRow(
		1, "account-1", "openai", "apikey", credentials, extra, nil,
		3, nil, 10, 1.0, "active", nil, nil, nil, true, true, nil, nil, nil,
		nil, nil, nil, nil, nil, 1, "unselected", "active", false, "standard", false, 50,
	).AddRow(
		1, "account-1", "openai", "apikey", credentials, extra, nil,
		3, nil, 10, 1.0, "active", nil, nil, nil, true, true, nil, nil, nil,
		nil, nil, nil, nil, nil, 2, "selected", "active", false, "standard", false, 40,
	).AddRow(
		2, "account-2", "anthropic", "apikey", credentials, extra, nil,
		3, nil, 20, 1.0, "error", "broken", nil, nil, true, false, nil, nil, nil,
		nil, nil, nil, nil, nil, 2, "selected", "active", false, "standard", false, 30,
	)
	mock.ExpectQuery(regexp.QuoteMeta(legacyAccountPlanQuery)).
		WithArgs("{2}").
		WillReturnRows(rows)

	snapshots, err := loadLegacyAccountPlanSnapshots(context.Background(), db, []int64{2})
	require.NoError(t, err)
	require.Len(t, snapshots, 2)
	assert.Equal(t, int64(1), snapshots[0].ID)
	assert.Equal(t, int64(2), snapshots[1].ID)
	require.Len(t, snapshots[0].Groups, 1)
	assert.Equal(t, int64(2), snapshots[0].Groups[0].ID)
	assert.Equal(t, "selected", snapshots[0].Groups[0].Name)
	assert.True(t, snapshots[1].ErrorPresent)
	assert.False(t, snapshots[1].Schedulable)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestBuildNativeChannelPlanPreservesStatusAndReversesPriority(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	base := legacyAccountPlanSnapshot{
		ID: 1, Name: "active", Platform: "openai", AuthType: "apikey",
		CredentialPresent: true, CredentialRef: "legacy-account:1:credential",
		BaseURL: "https://upstream.test/v1", Models: []string{"model-a"},
		Groups: []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
		Status: "active", Schedulable: true, Priority: 10,
	}
	channel, err := buildNativeChannelPlan(base, 30, now)
	require.NoError(t, err)
	assert.Equal(t, constant.ChannelTypeOpenAI, channel.Type)
	assert.Equal(t, int64(20), channel.Priority)
	assert.Equal(t, common.ChannelStatusEnabled, channel.Status)

	base.Status = "error"
	base.ErrorPresent = true
	channel, err = buildNativeChannelPlan(base, 30, now)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, channel.Status)

	base.Status = "active"
	base.ErrorPresent = false
	base.Schedulable = false
	channel, err = buildNativeChannelPlan(base, 30, now)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, channel.Status)
}

func TestBuildNativeChannelPlanDisablesAccountsInCooldown(t *testing.T) {
	future := time.Now().Add(time.Hour)
	base := legacyAccountPlanSnapshot{
		ID: 1, Name: "cooldown", Platform: "anthropic", AuthType: "apikey",
		CredentialPresent: true, CredentialRef: "legacy-account:1:credential",
		BaseURL: "https://upstream.test/v1", Models: []string{"model-a"},
		Groups: []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
		Status: "active", Schedulable: true, Priority: 10, RateLimitReset: true, RateLimitResetAt: &future,
	}
	channel, err := buildNativeChannelPlan(base, 10, time.Now())
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, channel.Status)
}

func TestBuildNativeChannelPlanIgnoresStaleCooldownProjectionWithoutTimestamp(t *testing.T) {
	base := legacyAccountPlanSnapshot{
		ID: 1, Name: "stale-cooldown", Platform: "anthropic", AuthType: "apikey",
		CredentialPresent: true, CredentialRef: "legacy-account:1:credential",
		BaseURL: "https://upstream.test/v1", Models: []string{"model-a"},
		Groups: []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
		Status: "active", Schedulable: true, Priority: 10,
		RateLimited: true, RateLimitReset: true, Overloaded: true, TemporarilyPaused: true,
	}
	channel, err := buildNativeChannelPlan(base, 10, time.Now())
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, channel.Status)
	assert.NotContains(t, channel.Warnings, "legacy cooldown state is preserved as disabled status only; NewAPI retry/cooldown state must be revalidated")
}

func TestBuildNativeChannelPlanDoesNotDisableExpiredCooldown(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	expired := now.Add(-time.Minute)
	base := legacyAccountPlanSnapshot{
		ID: 1, Name: "recovered", Platform: "openai", AuthType: "apikey",
		CredentialPresent: true, CredentialRef: "legacy-account:1:credential",
		Models: []string{"model-a"},
		Groups: []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
		Status: "active", Schedulable: true, Priority: 10,
		RateLimited: true, RateLimitReset: true, RateLimitedAt: &expired, RateLimitResetAt: &expired,
		Overloaded: true, OverloadUntil: &expired, TemporarilyPaused: true, TemporarilyPausedUntil: &expired,
	}
	channel, err := buildNativeChannelPlan(base, 10, now)
	require.NoError(t, err)
	assert.Equal(t, common.ChannelStatusEnabled, channel.Status)
	assert.NotContains(t, channel.Warnings, "legacy cooldown state is preserved as disabled status only; NewAPI retry/cooldown state must be revalidated")
}

func TestBuildNativeChannelPlanWarnsForVideoModels(t *testing.T) {
	now := time.Date(2026, 9, 7, 0, 0, 0, 0, time.UTC)
	snapshot := legacyAccountPlanSnapshot{
		ID: 70, Name: "video", Platform: "openai", AuthType: "apikey",
		CredentialPresent: true, Models: []string{"video-ds-2.0", "video-ds-2.0-fast"},
		Groups: []legacyAccountGroupPlan{{ID: 27, Name: "video", Priority: 1, Status: "active", SubscriptionType: "standard"}},
		Status: "active", Schedulable: true, Priority: 1,
	}
	channel, err := buildNativeChannelPlan(snapshot, 1, now)
	require.NoError(t, err)
	assert.Contains(t, channel.Warnings, "video models require a real NewAPI create/status request and billing verification before cutover")
}

func TestHasVideoModel(t *testing.T) {
	assert.True(t, hasVideoModel([]string{"video-ds-2.0"}))
	assert.True(t, hasVideoModel([]string{"sora-2"}))
	assert.False(t, hasVideoModel([]string{"claude-sonnet-4-5"}))
}

func TestBuildNativeSchedulerPlanReportsUnknownPlatformsWithoutEmittingSecrets(t *testing.T) {
	snapshots := []legacyAccountPlanSnapshot{
		{
			ID: 1, Name: "known", Platform: "openai", AuthType: "apikey", CredentialPresent: true,
			CredentialRef: "legacy-account:1:credential", BaseURL: "https://upstream.test",
			Models: []string{"model-a"}, Groups: []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
			Status: "active", Schedulable: true, Priority: 10,
		},
		{
			ID: 2, Name: "unsupported", Platform: "jimeng", AuthType: "apikey", CredentialPresent: true,
			CredentialRef: "legacy-account:2:credential", BaseURL: "https://upstream.test",
			Models: []string{"model-a"}, Groups: []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
			Status: "active", Schedulable: true, Priority: 20,
		},
	}
	plan, err := buildNativeSchedulerPlan(snapshots, []int64{2}, time.Unix(0, 0))
	require.NoError(t, err)
	assert.Equal(t, 1, plan.Report.Planned)
	assert.Equal(t, 1, plan.Report.Skipped)
	require.Len(t, plan.Report.Unsupported, 1)
	assert.Contains(t, plan.Report.Unsupported[0].Reason, "no verified native")

	raw, err := common.Marshal(plan)
	require.NoError(t, err)
	serialized := string(raw)
	for _, secret := range []string{"api-secret-value", "access-secret-value", "refresh-secret-value"} {
		assert.NotContains(t, serialized, secret)
	}
}

func TestStringMapAndSliceValuesRejectMalformedJSON(t *testing.T) {
	for _, value := range []any{
		map[string]any{"": "target"},
		map[string]any{"source": ""},
		map[string]any{"source": 123},
		map[string]any{"source,comma": "target"},
	} {
		_, err := stringMapValue(value)
		require.Error(t, err)
	}
	for _, value := range []any{
		map[string]string{"": "target"},
		map[string]string{"source": ""},
		map[string]string{"source,comma": "target"},
		map[string]string{"source*": "target"},
	} {
		_, err := stringMapValue(value)
		require.Error(t, err)
	}

	for _, value := range []any{
		map[string]any{"source*": "target"},
		map[string]any{"source": "target", " source ": "other"},
		map[string]any{"a": "b", "b": "a"},
	} {
		_, err := stringMapValue(value)
		require.Error(t, err)
	}

	got, err := stringMapValue(map[string]any{" source ": " target "})
	require.NoError(t, err)
	assert.Equal(t, map[string]string{"source": "target"}, got)
	for _, value := range []any{
		[]any{"ok", ""},
		[]any{"ok", 1},
		[]any{nil},
	} {
		_, err := stringSliceValue(value)
		require.Error(t, err)
	}
}

func TestNativeSchedulerPlanJSONHasNoCredentialField(t *testing.T) {
	plan := nativeSchedulerPlan{
		Version:     nativeSchedulerPlanVersion,
		GeneratedAt: time.Unix(0, 0).UTC(),
		Accounts: []legacyAccountPlanSnapshot{{
			ID: 9, Name: "safe", CredentialKeys: []string{"api_key"},
			CredentialRef: "legacy-account:9:credential", CredentialPresent: true,
		}},
		Channels: []nativeChannelPlan{{
			SourceAccountID: 9, KeyRef: "legacy-account:9:credential",
			Setting: map[string]any{"legacy_account_id": int64(9)},
		}},
	}
	raw, err := common.Marshal(plan)
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, common.Unmarshal(raw, &decoded))
	assert.NotContains(t, string(raw), `"credentials"`)
	assert.NotContains(t, string(raw), `"api_key":"`)
	assert.NotContains(t, string(raw), "Bearer")
}

func TestLoadLegacyAccountPlanSnapshotsRejectsInvalidCredentialJSON(t *testing.T) {
	db, mock := newMigrationSQLMock(t)
	columns := []string{
		"id", "name", "platform", "type", "credentials", "extra", "proxy_id",
		"concurrency", "load_factor", "priority", "rate_multiplier", "status",
		"error_message", "last_used_at", "expires_at", "auto_pause_on_expired",
		"schedulable", "rate_limited_at", "rate_limit_reset_at", "overload_until",
		"temp_unschedulable_until", "temp_unschedulable_reason", "session_window_start",
		"session_window_end", "session_window_status", "group_id", "group_name",
		"group_status", "group_exclusive", "subscription_type", "group_deleted",
		"group_priority",
	}
	rows := sqlmock.NewRows(columns).AddRow(
		1, "account", "openai", "apikey", []byte(`not-json`), []byte(`{}`), nil,
		3, nil, 10, 1.0, "active", nil, nil, nil, true, true, nil, nil, nil,
		nil, nil, nil, nil, nil, 2, "selected", "active", false, "standard", false, 50,
	)
	mock.ExpectQuery(regexp.QuoteMeta(legacyAccountPlanQuery)).WithArgs("{2}").WillReturnRows(rows)
	_, err := loadLegacyAccountPlanSnapshots(context.Background(), db, []int64{2})
	require.ErrorContains(t, err, "invalid credentials JSON")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestDecodeLegacyPlanJSONAcceptsNullAsEmptyObject(t *testing.T) {
	value, err := decodeLegacyPlanJSON([]byte("null"), "credentials", 1)
	require.NoError(t, err)
	assert.Empty(t, value)

	_, err = decodeLegacyPlanJSON([]byte(`[1,2,3]`), "credentials", 1)
	require.Error(t, err)
}

func TestNativeSchedulerPlanOutputIsDeterministicForMapFields(t *testing.T) {
	snapshot := legacyAccountPlanSnapshot{
		ID: 1, Name: "safe", Platform: "openai", AuthType: "apikey", CredentialPresent: true,
		CredentialRef: "legacy-account:1:credential", BaseURL: "https://upstream.test", Models: []string{"a"},
		ModelMapping: map[string]string{"z": "last", "a": "first"},
		Groups:       []legacyAccountGroupPlan{{ID: 2, Name: "selected", Status: "active", SubscriptionType: "standard"}},
		Status:       "active", Schedulable: true,
	}
	left, err := buildNativeSchedulerPlan([]legacyAccountPlanSnapshot{snapshot}, []int64{2}, time.Unix(0, 0))
	require.NoError(t, err)
	right, err := buildNativeSchedulerPlan([]legacyAccountPlanSnapshot{snapshot}, []int64{2}, time.Unix(0, 0))
	require.NoError(t, err)
	leftRaw, err := common.Marshal(left)
	require.NoError(t, err)
	rightRaw, err := common.Marshal(right)
	require.NoError(t, err)
	assert.Equal(t, string(leftRaw), string(rightRaw))
	assert.True(t, strings.Contains(string(leftRaw), `"model_mapping"`))
}
