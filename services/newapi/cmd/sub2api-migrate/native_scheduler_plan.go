package main

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

const (
	nativeSchedulerPlanVersion = "sub2api-native-channel-plan-v1"
	nativeSchedulerGroupEnv    = "NATIVE_SCHEDULER_GROUP_IDS"
	nativeSchedulerTagPrefix   = "sub2api-native:"
)

// legacyAccountPlanQuery intentionally reads the source account state only. It
// does not select credential values into the plan output; credentials are
// decoded in memory solely to validate them and to create stable references.
const legacyAccountPlanQuery = `
	SELECT
		a.id,
		a.name,
		a.platform,
		a.type,
		a.credentials,
		a.extra,
		a.proxy_id,
		a.concurrency,
		a.load_factor,
		a.priority,
		a.rate_multiplier,
		a.status,
		a.error_message,
		a.last_used_at,
		a.expires_at,
		a.auto_pause_on_expired,
		a.schedulable,
		a.rate_limited_at,
		a.rate_limit_reset_at,
		a.overload_until,
		a.temp_unschedulable_until,
		a.temp_unschedulable_reason,
		a.session_window_start,
		a.session_window_end,
		a.session_window_status,
		g.id,
		g.name,
		g.status,
		g.is_exclusive,
		g.subscription_type,
		(g.deleted_at IS NOT NULL),
		ag.priority
	FROM accounts a
	LEFT JOIN account_groups ag ON ag.account_id = a.id
	LEFT JOIN groups g ON g.id = ag.group_id
	WHERE a.deleted_at IS NULL
	  AND ag.group_id = ANY($1)
	ORDER BY a.id, g.id
`

const bridgeGroupTagQuery = `
	SELECT tag
	FROM channels
	WHERE type = $1 AND tag LIKE $2
	ORDER BY tag
`

type legacyAccountGroupPlan struct {
	ID               int64  `json:"id"`
	Name             string `json:"name"`
	Priority         int    `json:"legacy_priority"`
	Status           string `json:"status"`
	Exclusive        bool   `json:"exclusive"`
	SubscriptionType string `json:"subscription_type"`
	Deleted          bool   `json:"deleted"`
}

// legacyAccountPlanSnapshot is deliberately a credential-safe representation
// of an account. Never add the credential map or a token field to this type.
type legacyAccountPlanSnapshot struct {
	ID                      int64                    `json:"id"`
	Name                    string                   `json:"name"`
	Platform                string                   `json:"platform"`
	AuthType                string                   `json:"auth_type"`
	CredentialKeys          []string                 `json:"credential_keys,omitempty"`
	CredentialPresent       bool                     `json:"credential_present"`
	CredentialRef           string                   `json:"credential_ref,omitempty"`
	BaseURL                 string                   `json:"base_url,omitempty"`
	ModelMapping            map[string]string        `json:"model_mapping,omitempty"`
	Models                  []string                 `json:"models,omitempty"`
	Groups                  []legacyAccountGroupPlan `json:"groups"`
	ProxyID                 *int64                   `json:"proxy_id,omitempty"`
	Concurrency             int                      `json:"concurrency"`
	LoadFactor              *int                     `json:"load_factor,omitempty"`
	Priority                int                      `json:"priority"`
	RateMultiplier          float64                  `json:"rate_multiplier"`
	Status                  string                   `json:"status"`
	Schedulable             bool                     `json:"schedulable"`
	ErrorPresent            bool                     `json:"error_present"`
	ExpiresAt               *time.Time               `json:"expires_at,omitempty"`
	AutoPauseOnExpired      bool                     `json:"auto_pause_on_expired"`
	RateLimited             bool                     `json:"rate_limited"`
	RateLimitReset          bool                     `json:"rate_limit_reset"`
	Overloaded              bool                     `json:"overloaded"`
	TemporarilyPaused       bool                     `json:"temporarily_paused"`
	RateLimitedAt           *time.Time               `json:"rate_limited_at,omitempty"`
	RateLimitResetAt        *time.Time               `json:"rate_limit_reset_at,omitempty"`
	OverloadUntil           *time.Time               `json:"overload_until,omitempty"`
	TemporarilyPausedUntil  *time.Time               `json:"temporarily_paused_until,omitempty"`
	SessionWindowConfigured bool                     `json:"session_window_configured"`
	SessionWindowStatus     string                   `json:"session_window_status,omitempty"`
}

type nativeChannelPlan struct {
	SourceAccountID int64             `json:"source_account_id"`
	Name            string            `json:"name"`
	Type            int               `json:"type"`
	TypeName        string            `json:"type_name"`
	AuthType        string            `json:"auth_type"`
	KeyRef          string            `json:"key_ref"`
	BaseURL         string            `json:"base_url"`
	Models          []string          `json:"models"`
	Groups          []string          `json:"groups"`
	ModelMapping    map[string]string `json:"model_mapping,omitempty"`
	Status          int               `json:"status"`
	Priority        int64             `json:"priority"`
	Weight          uint              `json:"weight"`
	Setting         map[string]any    `json:"setting,omitempty"`
	Tag             string            `json:"tag"`
	Warnings        []string          `json:"warnings,omitempty"`
}

type nativePlanIssue struct {
	AccountID int64  `json:"account_id"`
	Name      string `json:"name"`
	Reason    string `json:"reason"`
}

type nativeSchedulerPlanReport struct {
	Planned     int               `json:"planned"`
	Skipped     int               `json:"skipped"`
	Unsupported []nativePlanIssue `json:"unsupported,omitempty"`
	Warnings    []nativePlanIssue `json:"warnings,omitempty"`
}

type nativeSchedulerPlan struct {
	Version     string                      `json:"version"`
	GeneratedAt time.Time                   `json:"generated_at"`
	GroupFilter []int64                     `json:"group_filter"`
	Accounts    []legacyAccountPlanSnapshot `json:"accounts"`
	Channels    []nativeChannelPlan         `json:"channels"`
	Report      nativeSchedulerPlanReport   `json:"report"`
}

func runNativeSchedulerPlan(ctx context.Context) error {
	sourceDSN, err := requiredEnv("SOURCE_SQL_DSN")
	if err != nil {
		return err
	}
	groupIDs, err := parseNativeSchedulerGroupIDs(strings.TrimSpace(os.Getenv(nativeSchedulerGroupEnv)))
	if err != nil {
		return err
	}

	source, err := openDatabase(ctx, sourceDSN)
	if err != nil {
		return fmt.Errorf("open source database for native scheduler plan: %w", err)
	}
	defer source.Close()

	// Prefer the actual type-59 bridge groups in the target database. An
	// explicit group list remains available for offline planning and tests.
	if len(groupIDs) == 0 {
		targetDSN := strings.TrimSpace(os.Getenv("TARGET_SQL_DSN"))
		if targetDSN == "" {
			return fmt.Errorf("%s is required in PLAN_ONLY mode when TARGET_SQL_DSN is not set", nativeSchedulerGroupEnv)
		}
		target, openErr := openDatabase(ctx, targetDSN)
		if openErr != nil {
			return fmt.Errorf("open target database for native scheduler plan: %w", openErr)
		}
		defer target.Close()
		groupIDs, err = loadBridgeGroupIDs(ctx, target)
		if err != nil {
			return err
		}
	}
	if len(groupIDs) == 0 {
		return errors.New("no migration-managed bridge groups found; set NATIVE_SCHEDULER_GROUP_IDS explicitly")
	}

	snapshots, err := loadLegacyAccountPlanSnapshots(ctx, source, groupIDs)
	if err != nil {
		return err
	}
	plan, err := buildNativeSchedulerPlan(snapshots, groupIDs, time.Now().UTC())
	if err != nil {
		return err
	}
	raw, err := common.Marshal(plan)
	if err != nil {
		return fmt.Errorf("encode native scheduler plan: %w", err)
	}
	fmt.Println(string(raw))
	return nil
}

func parseNativeSchedulerGroupIDs(raw string) ([]int64, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	seen := make(map[int64]struct{})
	for _, item := range strings.Split(raw, ",") {
		value, err := strconv.ParseInt(strings.TrimSpace(item), 10, 64)
		if err != nil || value <= 0 {
			return nil, fmt.Errorf("%s contains invalid group id %q", nativeSchedulerGroupEnv, item)
		}
		seen[value] = struct{}{}
	}
	groupIDs := make([]int64, 0, len(seen))
	for value := range seen {
		groupIDs = append(groupIDs, value)
	}
	sort.Slice(groupIDs, func(i, j int) bool { return groupIDs[i] < groupIDs[j] })
	return groupIDs, nil
}

func loadBridgeGroupIDs(ctx context.Context, target *sql.DB) ([]int64, error) {
	rows, err := target.QueryContext(ctx, bridgeGroupTagQuery, constant.ChannelTypeSub2API, bridgeChannelTagPrefix+"%")
	if err != nil {
		return nil, fmt.Errorf("query migration-managed bridge groups: %w", err)
	}
	defer rows.Close()
	seen := make(map[int64]struct{})
	for rows.Next() {
		var tag sql.NullString
		if err := rows.Scan(&tag); err != nil {
			return nil, fmt.Errorf("scan migration-managed bridge tag: %w", err)
		}
		if !tag.Valid {
			continue
		}
		id, ok := parseBridgeGroupTag(tag.String)
		if ok {
			seen[id] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate migration-managed bridge tags: %w", err)
	}
	groupIDs := make([]int64, 0, len(seen))
	for id := range seen {
		groupIDs = append(groupIDs, id)
	}
	sort.Slice(groupIDs, func(i, j int) bool { return groupIDs[i] < groupIDs[j] })
	return groupIDs, nil
}

func parseBridgeGroupTag(tag string) (int64, bool) {
	if !strings.HasPrefix(tag, bridgeChannelTagPrefix) {
		return 0, false
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(tag, bridgeChannelTagPrefix), 10, 64)
	return id, err == nil && id > 0
}

func loadLegacyAccountPlanSnapshots(ctx context.Context, source *sql.DB, groupIDs []int64) ([]legacyAccountPlanSnapshot, error) {
	if len(groupIDs) == 0 {
		return nil, errors.New("at least one legacy group id is required")
	}
	rows, err := source.QueryContext(ctx, legacyAccountPlanQuery, postgresInt64Array(groupIDs))
	if err != nil {
		return nil, fmt.Errorf("query legacy accounts for native scheduler plan: %w", err)
	}
	defer rows.Close()

	filter := make(map[int64]struct{}, len(groupIDs))
	for _, id := range groupIDs {
		filter[id] = struct{}{}
	}
	type accountEntry struct {
		snapshot legacyAccountPlanSnapshot
		groups   map[int64]legacyAccountGroupPlan
	}
	entries := make(map[int64]*accountEntry)
	for rows.Next() {
		var (
			id, groupID, groupPriority, proxyID, concurrency, loadFactor, priority sql.NullInt64
			name, platform, authType, status, errorMessage                         sql.NullString
			rateMultiplier                                                         sql.NullFloat64
			lastUsedAt, expiresAt, rateLimitedAt, rateLimitResetAt, overloadUntil  sql.NullTime
			tempUnschedulableUntil, sessionWindowStart, sessionWindowEnd           sql.NullTime
			autoPauseBool, schedulableBool                                         sql.NullBool
			tempUnschedulableReason, sessionWindowStatus, groupName, groupStatus   sql.NullString
			groupExclusive, groupDeleted                                           sql.NullBool
			subscriptionType                                                       sql.NullString
		)
		var credentials, extra []byte
		if err := rows.Scan(
			&id, &name, &platform, &authType, &credentials, &extra, &proxyID,
			&concurrency, &loadFactor, &priority, &rateMultiplier, &status,
			&errorMessage, &lastUsedAt, &expiresAt, &autoPauseBool, &schedulableBool,
			&rateLimitedAt, &rateLimitResetAt, &overloadUntil, &tempUnschedulableUntil,
			&tempUnschedulableReason, &sessionWindowStart, &sessionWindowEnd,
			&sessionWindowStatus, &groupID, &groupName, &groupStatus, &groupExclusive,
			&subscriptionType, &groupDeleted, &groupPriority,
		); err != nil {
			return nil, fmt.Errorf("scan legacy account for native scheduler plan: %w", err)
		}
		if !id.Valid {
			return nil, errors.New("legacy account row has no id")
		}
		entry := entries[id.Int64]
		if entry == nil {
			credentialsMap, decodeErr := decodeLegacyPlanJSON(credentials, "credentials", id.Int64)
			if decodeErr != nil {
				return nil, decodeErr
			}
			extraMap, decodeErr := decodeLegacyPlanJSON(extra, "extra", id.Int64)
			if decodeErr != nil {
				return nil, decodeErr
			}
			snapshot, buildErr := snapshotLegacyAccount(
				id.Int64, name.String, platform.String, authType.String, credentialsMap,
				extraMap, proxyID, concurrency, loadFactor, priority, rateMultiplier,
				status.String, errorMessage, lastUsedAt, expiresAt, autoPauseBool,
				schedulableBool, rateLimitedAt, rateLimitResetAt, overloadUntil,
				tempUnschedulableUntil, tempUnschedulableReason, sessionWindowStart,
				sessionWindowEnd, sessionWindowStatus,
			)
			if buildErr != nil {
				return nil, buildErr
			}
			entry = &accountEntry{snapshot: snapshot, groups: make(map[int64]legacyAccountGroupPlan)}
			entries[id.Int64] = entry
		}
		if groupID.Valid {
			group := legacyAccountGroupPlan{
				ID: groupID.Int64, Name: strings.TrimSpace(groupName.String),
				Priority: int(groupPriority.Int64), Status: strings.TrimSpace(groupStatus.String),
				Exclusive:        groupExclusive.Valid && groupExclusive.Bool,
				SubscriptionType: strings.TrimSpace(subscriptionType.String),
				Deleted:          groupDeleted.Valid && groupDeleted.Bool,
			}
			entry.groups[group.ID] = group
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy accounts for native scheduler plan: %w", err)
	}

	snapshots := make([]legacyAccountPlanSnapshot, 0, len(entries))
	for _, entry := range entries {
		selected := false
		for groupID := range entry.groups {
			if _, ok := filter[groupID]; ok {
				selected = true
				break
			}
		}
		if !selected {
			continue
		}
		entry.snapshot.Groups = make([]legacyAccountGroupPlan, 0, len(entry.groups))
		for _, group := range entry.groups {
			if _, ok := filter[group.ID]; ok {
				entry.snapshot.Groups = append(entry.snapshot.Groups, group)
			}
		}
		sort.Slice(entry.snapshot.Groups, func(i, j int) bool {
			if entry.snapshot.Groups[i].ID == entry.snapshot.Groups[j].ID {
				return entry.snapshot.Groups[i].Name < entry.snapshot.Groups[j].Name
			}
			return entry.snapshot.Groups[i].ID < entry.snapshot.Groups[j].ID
		})
		snapshots = append(snapshots, entry.snapshot)
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].ID < snapshots[j].ID })
	return snapshots, nil
}

type postgresInt64Array []int64

func (value postgresInt64Array) Value() (driver.Value, error) {
	if len(value) == 0 {
		return "{}", nil
	}
	items := make([]string, len(value))
	for index, item := range value {
		if item <= 0 {
			return nil, fmt.Errorf("array item %d must be positive", item)
		}
		items[index] = strconv.FormatInt(item, 10)
	}
	return "{" + strings.Join(items, ",") + "}", nil
}

func decodeLegacyPlanJSON(raw []byte, field string, accountID int64) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	value := make(map[string]any)
	if err := common.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("legacy account %d has invalid %s JSON: %w", accountID, field, err)
	}
	return value, nil
}

func snapshotLegacyAccount(
	id int64,
	name, platform, authType string,
	credentials, extra map[string]any,
	proxyID, concurrency, loadFactor, priority sql.NullInt64,
	rateMultiplier sql.NullFloat64,
	status string,
	errorMessage sql.NullString,
	lastUsedAt, expiresAt sql.NullTime,
	autoPause, schedulable sql.NullBool,
	rateLimitedAt, rateLimitResetAt, overloadUntil, tempUnschedulableUntil sql.NullTime,
	tempUnschedulableReason sql.NullString,
	sessionWindowStart, sessionWindowEnd sql.NullTime,
	sessionWindowStatus sql.NullString,
) (legacyAccountPlanSnapshot, error) {
	platform = strings.ToLower(strings.TrimSpace(platform))
	authType = strings.ToLower(strings.TrimSpace(authType))
	credentialKeys := sortedMapKeys(credentials)
	// Keep the plan's eligibility decision identical to the importer. OAuth,
	// setup-token, and refresh-token values are not valid NewAPI channel keys.
	keyPresent := nativeSchedulerCredentialValue(credentials, authType) != ""
	modelMapping, err := stringMapValue(credentials["model_mapping"])
	if err != nil {
		return legacyAccountPlanSnapshot{}, fmt.Errorf("legacy account %d model_mapping: %w", id, err)
	}
	models, err := legacyPlanModels(credentials, extra, modelMapping)
	if err != nil {
		return legacyAccountPlanSnapshot{}, fmt.Errorf("legacy account %d models: %w", id, err)
	}
	baseURL, err := legacyPlanBaseURL(credentials)
	if err != nil {
		return legacyAccountPlanSnapshot{}, fmt.Errorf("legacy account %d base_url: %w", id, err)
	}
	rate := 1.0
	if rateMultiplier.Valid {
		rate = rateMultiplier.Float64
	}
	if rate < 0 {
		return legacyAccountPlanSnapshot{}, fmt.Errorf("legacy account %d has negative rate_multiplier", id)
	}

	snapshot := legacyAccountPlanSnapshot{
		ID: id, Name: strings.TrimSpace(name), Platform: platform, AuthType: authType,
		CredentialKeys: credentialKeys, CredentialPresent: keyPresent,
		CredentialRef: fmt.Sprintf("legacy-account:%d:credential", id), BaseURL: baseURL,
		ModelMapping: modelMapping, Models: models, ProxyID: nullableInt64(proxyID),
		Concurrency: nullableInt64Value(concurrency, 0), LoadFactor: nullableIntValue(loadFactor),
		Priority: nullableInt64Value(priority, 50), RateMultiplier: rate,
		Status: strings.ToLower(strings.TrimSpace(status)), Schedulable: !schedulable.Valid || schedulable.Bool,
		ErrorPresent: errorMessage.Valid && strings.TrimSpace(errorMessage.String) != "",
		ExpiresAt:    nullableTime(expiresAt), AutoPauseOnExpired: !autoPause.Valid || autoPause.Bool,
		RateLimited: rateLimitedAt.Valid, RateLimitReset: rateLimitResetAt.Valid,
		Overloaded: overloadUntil.Valid, TemporarilyPaused: tempUnschedulableUntil.Valid,
		RateLimitedAt: nullableTime(rateLimitedAt), RateLimitResetAt: nullableTime(rateLimitResetAt),
		OverloadUntil: nullableTime(overloadUntil), TemporarilyPausedUntil: nullableTime(tempUnschedulableUntil),
		SessionWindowConfigured: sessionWindowStart.Valid || sessionWindowEnd.Valid || sessionWindowStatus.Valid,
		SessionWindowStatus:     strings.TrimSpace(sessionWindowStatus.String),
	}
	return snapshot, nil
}

func buildNativeSchedulerPlan(snapshots []legacyAccountPlanSnapshot, groupIDs []int64, now time.Time) (nativeSchedulerPlan, error) {
	maxPriority := 0
	for _, snapshot := range snapshots {
		if snapshot.Priority < 0 {
			return nativeSchedulerPlan{}, fmt.Errorf("legacy account %d has negative priority", snapshot.ID)
		}
		if snapshot.Priority > maxPriority {
			maxPriority = snapshot.Priority
		}
	}
	plan := nativeSchedulerPlan{
		Version: nativeSchedulerPlanVersion, GeneratedAt: now.UTC(), GroupFilter: append([]int64(nil), groupIDs...),
		Accounts: append([]legacyAccountPlanSnapshot(nil), snapshots...),
		Channels: make([]nativeChannelPlan, 0, len(snapshots)),
	}
	for _, snapshot := range snapshots {
		channel, err := buildNativeChannelPlan(snapshot, maxPriority, now)
		if err != nil {
			plan.Report.Skipped++
			plan.Report.Unsupported = append(plan.Report.Unsupported, nativePlanIssue{AccountID: snapshot.ID, Name: snapshot.Name, Reason: err.Error()})
			continue
		}
		plan.Report.Planned++
		for _, warning := range channel.Warnings {
			plan.Report.Warnings = append(plan.Report.Warnings, nativePlanIssue{AccountID: snapshot.ID, Name: snapshot.Name, Reason: warning})
		}
		plan.Channels = append(plan.Channels, channel)
	}
	return plan, nil
}

func buildNativeChannelPlan(snapshot legacyAccountPlanSnapshot, maxLegacyPriority int, now time.Time) (nativeChannelPlan, error) {
	channelType, err := legacyPlatformChannelType(snapshot.Platform)
	if err != nil {
		return nativeChannelPlan{}, err
	}
	if snapshot.AuthType != "apikey" && snapshot.AuthType != "api_key" && snapshot.AuthType != "upstream" {
		return nativeChannelPlan{}, fmt.Errorf("auth type %q has no lossless NewAPI channel key mapping", snapshot.AuthType)
	}
	if !snapshot.CredentialPresent {
		return nativeChannelPlan{}, errors.New("account has no usable API credential; secret must be configured before import")
	}
	if len(snapshot.Models) == 0 {
		return nativeChannelPlan{}, errors.New("account has no explicit model list; passthrough accounts require manual model discovery")
	}
	if len(snapshot.Groups) == 0 {
		return nativeChannelPlan{}, errors.New("account has no legacy group")
	}
	if _, err := validateNativeModelMapping(cloneStringMap(snapshot.ModelMapping)); err != nil {
		return nativeChannelPlan{}, err
	}
	if err := validateNativeChannelBaseURL(snapshot.BaseURL); err != nil {
		return nativeChannelPlan{}, err
	}

	groups := make([]string, 0, len(snapshot.Groups))
	groupPriorities := make(map[string]int, len(snapshot.Groups))
	for _, group := range snapshot.Groups {
		if group.Deleted || group.Status != "active" || group.Exclusive || (group.SubscriptionType != "" && group.SubscriptionType != "standard") {
			return nativeChannelPlan{}, fmt.Errorf("legacy group %d/%q is not an active standard group", group.ID, group.Name)
		}
		if group.Name == "" || len(group.Name) > 64 || strings.Contains(group.Name, ",") {
			return nativeChannelPlan{}, fmt.Errorf("legacy group %d has an unsupported name %q", group.ID, group.Name)
		}
		if _, exists := groupPriorities[group.Name]; exists {
			continue
		}
		groups = append(groups, group.Name)
		groupPriorities[group.Name] = group.Priority
	}
	warnings := make([]string, 0, 8)
	if snapshot.Concurrency != 0 || snapshot.LoadFactor != nil {
		warnings = append(warnings, "account concurrency/load_factor is not represented by a NewAPI channel; validate capacity before cutover")
	}
	if snapshot.ProxyID != nil {
		warnings = append(warnings, "proxy_id requires manual NewAPI channel transport configuration")
	}
	if snapshot.RateMultiplier != 1 {
		warnings = append(warnings, "account rate_multiplier is not represented by a NewAPI channel")
	}
	if hasVideoModel(snapshot.Models) {
		warnings = append(warnings, "video models require a real NewAPI create/status request and billing verification before cutover")
	}
	if snapshotLegacyCooldownActive(snapshot, now) {
		warnings = append(warnings, "legacy cooldown state is preserved as disabled status only; NewAPI retry/cooldown state must be revalidated")
	}
	if snapshot.SessionWindowConfigured {
		warnings = append(warnings, "legacy session window is not represented by a NewAPI channel")
	}
	if snapshot.ExpiresAt != nil || !snapshot.AutoPauseOnExpired {
		warnings = append(warnings, "legacy expiry/auto-pause policy requires an explicit NewAPI operational check")
	}
	if len(groupPriorities) > 1 {
		priorities := make(map[int]struct{}, len(groupPriorities))
		for _, value := range groupPriorities {
			priorities[value] = struct{}{}
		}
		if len(priorities) > 1 {
			warnings = append(warnings, "per-group account priorities collapse to one NewAPI channel priority")
		}
	}

	status := common.ChannelStatusManuallyDisabled
	if snapshot.Status == "active" && snapshot.Schedulable {
		status = common.ChannelStatusEnabled
	}
	if snapshot.ExpiresAt != nil && snapshot.AutoPauseOnExpired && !now.Before(*snapshot.ExpiresAt) {
		status = common.ChannelStatusManuallyDisabled
		warnings = append(warnings, "account is expired and remains disabled")
	}
	if snapshot.ErrorPresent || snapshot.Status == "error" {
		status = common.ChannelStatusManuallyDisabled
	}
	if snapshotLegacyCooldownActive(snapshot, now) {
		status = common.ChannelStatusManuallyDisabled
	}
	if snapshot.Status != "active" && snapshot.Status != "disabled" && snapshot.Status != "error" && snapshot.Status != "expired" {
		return nativeChannelPlan{}, fmt.Errorf("legacy account has unsupported status %q", snapshot.Status)
	}

	setting := map[string]any{
		"legacy_account_id":  snapshot.ID,
		"legacy_auth_type":   snapshot.AuthType,
		"legacy_concurrency": snapshot.Concurrency,
	}
	if snapshot.ProxyID != nil {
		setting["legacy_proxy_id"] = *snapshot.ProxyID
	}
	if snapshot.LoadFactor != nil {
		setting["legacy_load_factor"] = *snapshot.LoadFactor
	}
	if snapshot.RateMultiplier != 1 {
		setting["legacy_rate_multiplier"] = snapshot.RateMultiplier
	}
	return nativeChannelPlan{
		SourceAccountID: snapshot.ID,
		Name:            "NewAPI native - " + snapshot.Name,
		Type:            channelType,
		TypeName:        constant.GetChannelTypeName(channelType),
		AuthType:        snapshot.AuthType,
		KeyRef:          snapshot.CredentialRef,
		BaseURL:         snapshot.BaseURL,
		Models:          append([]string(nil), snapshot.Models...),
		Groups:          groups,
		ModelMapping:    cloneStringMap(snapshot.ModelMapping),
		Status:          status,
		Priority:        int64(maxLegacyPriority - snapshot.Priority),
		Weight:          0,
		Setting:         setting,
		Tag:             fmt.Sprintf("%s%d", nativeSchedulerTagPrefix, snapshot.ID),
		Warnings:        warnings,
	}, nil
}

func hasVideoModel(models []string) bool {
	for _, model := range models {
		name := strings.ToLower(strings.TrimSpace(model))
		if strings.Contains(name, "video") || strings.HasPrefix(name, "sora-") {
			return true
		}
	}
	return false
}

func snapshotLegacyCooldownActive(snapshot legacyAccountPlanSnapshot, now time.Time) bool {
	// The legacy boolean fields are projections of their timestamp columns. A
	// stale projection without a timestamp is not an active cooldown: treating
	// it as active would permanently disable the imported channel.
	for _, until := range []*time.Time{snapshot.RateLimitResetAt, snapshot.OverloadUntil, snapshot.TemporarilyPausedUntil} {
		if until != nil && now.Before(*until) {
			return true
		}
	}
	return false
}

func legacyPlatformChannelType(platform string) (int, error) {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "openai":
		return constant.ChannelTypeOpenAI, nil
	case "anthropic", "claude":
		return constant.ChannelTypeAnthropic, nil
	case "gemini":
		return constant.ChannelTypeGemini, nil
	case "grok", "xai":
		return constant.ChannelTypeXai, nil
	default:
		return 0, fmt.Errorf("legacy platform %q has no verified native NewAPI channel mapping", platform)
	}
}

func legacyPlanModels(credentials, extra map[string]any, mapping map[string]string) ([]string, error) {
	models := make(map[string]struct{})
	for _, source := range []map[string]any{credentials, extra} {
		for _, key := range []string{"models", "supported_models", "model_whitelist"} {
			values, err := stringSliceValue(source[key])
			if err != nil {
				return nil, fmt.Errorf("%s: %w", key, err)
			}
			for _, model := range values {
				models[model] = struct{}{}
			}
		}
	}
	for model := range mapping {
		if model != "*" {
			models[model] = struct{}{}
		}
	}
	result := make([]string, 0, len(models))
	for model := range models {
		if model == "" || len(model) > 255 || strings.Contains(model, ",") {
			return nil, fmt.Errorf("model %q is empty, too long, or contains a comma", model)
		}
		result = append(result, model)
	}
	sort.Strings(result)
	return result, nil
}

func legacyPlanBaseURL(credentials map[string]any) (string, error) {
	raw := strings.TrimSpace(stringValue(credentials["base_url"]))
	if raw == "" {
		return "", nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("URL must be an absolute http(s) URL")
	}
	// A URL userinfo can contain a secret. Keep the plan safe to share and let
	// the eventual importer require the operator to re-enter that transport data.
	parsed.User = nil
	if parsed.ForceQuery || parsed.RawQuery != "" {
		return "", errors.New("URL must not include a query; configure query parameters in the channel transport settings")
	}
	if parsed.Fragment != "" {
		return "", errors.New("URL must not include a fragment")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func validateNativeChannelBaseURL(raw string) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return errors.New("URL must be an absolute http(s) URL")
	}
	if parsed.User != nil {
		return errors.New("URL must not include userinfo")
	}
	if parsed.ForceQuery || parsed.RawQuery != "" {
		return errors.New("URL must not include a query; configure query parameters in the channel transport settings")
	}
	if parsed.Fragment != "" {
		return errors.New("URL must not include a fragment")
	}
	return nil
}

func stringValue(value any) string {
	switch value := value.(type) {
	case string:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func stringMapValue(value any) (map[string]string, error) {
	if value == nil {
		return map[string]string{}, nil
	}
	object, ok := value.(map[string]any)
	if !ok {
		if typed, typedOK := value.(map[string]string); typedOK {
			result := make(map[string]string, len(typed))
			originalKeys := make(map[string]string, len(typed))
			for key, mapped := range typed {
				normalizedKey := strings.TrimSpace(key)
				normalizedValue := strings.TrimSpace(mapped)
				if err := validateNativeModelMappingEntry(normalizedKey, normalizedValue); err != nil {
					return nil, err
				}
				if original, exists := originalKeys[normalizedKey]; exists && original != key {
					return nil, fmt.Errorf("model mapping contains duplicate source after trimming: %q", normalizedKey)
				}
				originalKeys[normalizedKey] = key
				result[normalizedKey] = normalizedValue
			}
			return validateNativeModelMapping(result)
		}
		return nil, errors.New("must be a JSON object")
	}
	result := make(map[string]string, len(object))
	originalKeys := make(map[string]string, len(object))
	for originalKey, raw := range object {
		key := strings.TrimSpace(originalKey)
		mapped, ok := raw.(string)
		if !ok {
			return nil, errors.New("mapping keys and values must be non-empty strings")
		}
		mapped = strings.TrimSpace(mapped)
		if err := validateNativeModelMappingEntry(key, mapped); err != nil {
			return nil, err
		}
		if original, exists := originalKeys[key]; exists && original != originalKey {
			return nil, fmt.Errorf("model mapping contains duplicate source after trimming: %q", key)
		}
		originalKeys[key] = originalKey
		result[key] = mapped
	}
	return validateNativeModelMapping(result)
}

func validateNativeModelMappingEntry(source, target string) error {
	if source == "" || target == "" {
		return fmt.Errorf("mapping keys and values must be non-empty strings")
	}
	if len(source) > 255 || len(target) > 255 || strings.Contains(source, ",") || strings.Contains(target, ",") {
		return errors.New("model mapping contains an invalid NewAPI model name")
	}
	// Sub2API treats a trailing '*' in a source as a prefix rule. NewAPI's
	// channel mapping is exact (and supports chained redirects), so importing
	// that rule would silently change which requests are routed.
	if strings.HasSuffix(source, "*") {
		return fmt.Errorf("model mapping source %q uses an unsupported wildcard", source)
	}
	return nil
}

func validateNativeModelMapping(mapping map[string]string) (map[string]string, error) {
	for source := range mapping {
		if err := validateNativeModelMappingEntry(source, mapping[source]); err != nil {
			return nil, err
		}
		current := source
		visited := map[string]struct{}{source: {}}
		for {
			next, exists := mapping[current]
			if !exists || next == current {
				break
			}
			if _, seen := visited[next]; seen {
				return nil, fmt.Errorf("model mapping contains a redirect cycle involving %q", next)
			}
			visited[next] = struct{}{}
			current = next
		}
	}
	return mapping, nil
}

func stringSliceValue(value any) ([]string, error) {
	if value == nil {
		return nil, nil
	}
	var raw []any
	switch typed := value.(type) {
	case []any:
		raw = typed
	case []string:
		raw = make([]any, len(typed))
		for index := range typed {
			raw[index] = typed[index]
		}
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil, nil
		}
		raw = []any{typed}
	default:
		return nil, errors.New("must be a string or string array")
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		model, ok := item.(string)
		model = strings.TrimSpace(model)
		if !ok || model == "" {
			return nil, errors.New("model list entries must be non-empty strings")
		}
		result = append(result, model)
	}
	return result, nil
}

func sortedMapKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func cloneStringMap(value map[string]string) map[string]string {
	if len(value) == 0 {
		return nil
	}
	result := make(map[string]string, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}

func nullableInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func nullableInt64Value(value sql.NullInt64, fallback int) int {
	if !value.Valid {
		return fallback
	}
	return int(value.Int64)
}

func nullableIntValue(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int64)
	return &result
}

func nullableInt(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int64)
	return &result
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time.UTC()
	return &result
}
