package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/shopspring/decimal"
	"golang.org/x/crypto/bcrypt"
)

const (
	migrationOptionKey = "Sub2APIMigrationVersion"
	bridgeUserEmail    = "newapi-bridge@internal.invalid"
	bridgeUserBalance  = int64(999_999_999_999)
	quotaPerUSD        = 500_000.0
)

type legacyUser struct {
	ID           int64
	Email        string
	PasswordHash string
	Role         string
	Balance      float64
	Concurrency  int
	Status       string
	Username     string
	CreatedAt    time.Time
	LastLoginAt  sql.NullTime
}

type legacyToken struct {
	ID           int64
	UserID       int64
	Key          string
	Name         string
	GroupName    string
	Status       string
	CreatedAt    time.Time
	LastUsedAt   sql.NullTime
	IPWhitelist  string
	Quota        float64
	QuotaUsed    float64
	ExpiresAt    sql.NullTime
	GroupDeleted bool
}

type bridgeGroup struct {
	ID              int64
	Name            string
	RateMultiplier  float64
	BridgeKey       string
	Models          []string
	BridgeBaseURL   string
	SourceModelURL  string
	SourceAPIKeyURL string
}

type legacyPriceInterval struct {
	MinTokens       int
	MaxTokens       *int
	InputPrice      float64
	OutputPrice     float64
	CacheWritePrice float64
	CacheReadPrice  float64
}

type legacyPrice struct {
	Model           string
	InputPrice      float64
	OutputPrice     float64
	CacheWritePrice float64
	CacheReadPrice  float64
	Intervals       []legacyPriceInterval
}

type migrationData struct {
	Users   []legacyUser
	Tokens  []legacyToken
	Groups  []bridgeGroup
	Prices  []legacyPrice
	Options map[string]string
}

type modelListResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func migrationCompleted(ctx context.Context, target *sql.DB, version string) (bool, error) {
	var value string
	err := target.QueryRowContext(ctx, `SELECT value FROM options WHERE key = $1`, migrationOptionKey).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read migration marker: %w", err)
	}
	if value != version {
		return false, fmt.Errorf("target has migration marker %q, expected %q", value, version)
	}
	return true, nil
}

func requireEmptyTarget(ctx context.Context, target *sql.DB) error {
	var userCount int
	if err := target.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&userCount); err != nil {
		return fmt.Errorf("count target users: %w", err)
	}
	if userCount != 0 {
		return fmt.Errorf("target database has %d users but no migration marker; refusing to overwrite it", userCount)
	}
	return nil
}

func auditSource(ctx context.Context, source *sql.DB) error {
	var unsupportedTokens int
	err := source.QueryRowContext(ctx, `
		SELECT count(*)
		FROM api_keys
		WHERE deleted_at IS NULL
		  AND (
			COALESCE(jsonb_array_length(ip_blacklist), 0) > 0
			OR rate_limit_5h > 0
			OR rate_limit_1d > 0
			OR rate_limit_7d > 0
		  )
	`).Scan(&unsupportedTokens)
	if err != nil {
		return fmt.Errorf("audit legacy API keys: %w", err)
	}
	if unsupportedTokens != 0 {
		return fmt.Errorf("%d API keys use blacklist or rolling rate-limit features that cannot be migrated losslessly", unsupportedTokens)
	}

	var unsupportedUsers int
	err = source.QueryRowContext(ctx, `
		SELECT count(*)
		FROM users
		WHERE deleted_at IS NULL
		  AND email <> $1
		  AND (
			totp_enabled
			OR password_hash = ''
			OR length(username) > 20
			OR length(email) > 50
		  )
	`, bridgeUserEmail).Scan(&unsupportedUsers)
	if err != nil {
		return fmt.Errorf("audit legacy users: %w", err)
	}
	if unsupportedUsers != 0 {
		return fmt.Errorf("%d users have TOTP, missing passwords, or identifiers outside NewAPI limits", unsupportedUsers)
	}
	if err := auditLegacyUserIdentifiers(ctx, source); err != nil {
		return err
	}

	var unsupportedIdentities int
	err = source.QueryRowContext(ctx, `SELECT count(*) FROM auth_identities WHERE provider_type <> 'email'`).Scan(&unsupportedIdentities)
	if err != nil {
		return fmt.Errorf("audit legacy identities: %w", err)
	}
	if unsupportedIdentities != 0 {
		return fmt.Errorf("%d non-email identities require an explicit OAuth migration", unsupportedIdentities)
	}

	var passkeys int
	if err := source.QueryRowContext(ctx, `SELECT count(*) FROM passkey_credentials`).Scan(&passkeys); err != nil {
		return fmt.Errorf("audit legacy passkeys: %w", err)
	}
	if passkeys != 0 {
		return fmt.Errorf("%d passkeys cannot be migrated to NewAPI without re-enrollment", passkeys)
	}

	var frozenBalances int
	var userRPMLimits int
	var groupRPMLimits int
	var userGroupOverrides int
	var nonTokenPricing int
	var restrictedActiveGroups int
	var unsupportedActiveGroupPricing int
	err = source.QueryRowContext(ctx, `
		SELECT
			(SELECT count(*) FROM users WHERE deleted_at IS NULL AND email <> $1 AND frozen_balance <> 0),
			(SELECT count(*) FROM users WHERE deleted_at IS NULL AND email <> $1 AND rpm_limit <> 0),
			(SELECT count(*) FROM groups WHERE deleted_at IS NULL AND status = 'active' AND rpm_limit <> 0),
			(
				SELECT count(*)
				FROM user_group_rate_multipliers ugr
				JOIN users u ON u.id = ugr.user_id
				WHERE u.deleted_at IS NULL AND u.email <> $1
				),
				(SELECT count(*) FROM channel_model_pricing WHERE billing_mode <> 'token'),
				(
					SELECT count(*)
					FROM groups
					WHERE deleted_at IS NULL
					  AND status = 'active'
					  AND (is_exclusive OR subscription_type <> 'standard')
				),
				(
					SELECT count(*)
					FROM groups
					WHERE deleted_at IS NULL
					  AND status = 'active'
					  AND NOT is_exclusive
					  AND subscription_type = 'standard'
					  AND (
						peak_rate_enabled
						OR image_rate_independent
						OR video_rate_independent
						OR image_price_1k IS NOT NULL
						OR image_price_2k IS NOT NULL
						OR image_price_4k IS NOT NULL
					  )
				)
	`, bridgeUserEmail).Scan(
		&frozenBalances,
		&userRPMLimits,
		&groupRPMLimits,
		&userGroupOverrides,
		&nonTokenPricing,
		&restrictedActiveGroups,
		&unsupportedActiveGroupPricing,
	)
	if err != nil {
		return fmt.Errorf("audit legacy billing and rate-limit state: %w", err)
	}
	if err := validateLegacyUnsupportedState(
		frozenBalances,
		userRPMLimits,
		groupRPMLimits,
		userGroupOverrides,
		nonTokenPricing,
		restrictedActiveGroups,
		unsupportedActiveGroupPricing,
	); err != nil {
		return err
	}

	var privilegedKeys int
	var allowedGroupAssignments int
	var activeSubscriptions int
	err = source.QueryRowContext(ctx, `
		SELECT
			(
				SELECT count(*)
				FROM api_keys k
				JOIN groups g ON g.id = k.group_id
				JOIN users u ON u.id = k.user_id
				WHERE k.deleted_at IS NULL
				  AND k.status = 'active'
				  AND u.deleted_at IS NULL
				  AND u.email <> $1
				  AND (g.is_exclusive OR g.subscription_type <> 'standard')
			),
			(
				SELECT count(*)
				FROM user_allowed_groups uag
				JOIN users u ON u.id = uag.user_id
				WHERE u.deleted_at IS NULL AND u.email <> $1
			),
			(
				SELECT count(*)
				FROM user_subscriptions us
				JOIN users u ON u.id = us.user_id
				WHERE us.deleted_at IS NULL
				  AND us.status = 'active'
				  AND us.starts_at <= now()
				  AND us.expires_at > now()
				  AND u.deleted_at IS NULL
				  AND u.email <> $1
			)
	`, bridgeUserEmail).Scan(&privilegedKeys, &allowedGroupAssignments, &activeSubscriptions)
	if err != nil {
		return fmt.Errorf("audit legacy group access controls: %w", err)
	}
	if err := validateLegacyGroupAccessState(privilegedKeys, allowedGroupAssignments, activeSubscriptions); err != nil {
		return err
	}
	return nil
}

func auditLegacyUserIdentifiers(ctx context.Context, source *sql.DB) error {
	rows, err := source.QueryContext(ctx, `
		SELECT id, email, username
		FROM users
		WHERE deleted_at IS NULL AND email <> $1
		ORDER BY id
	`, bridgeUserEmail)
	if err != nil {
		return fmt.Errorf("audit legacy user identifiers: %w", err)
	}
	defer rows.Close()

	users := make([]legacyUser, 0)
	for rows.Next() {
		var user legacyUser
		if err := rows.Scan(&user.ID, &user.Email, &user.Username); err != nil {
			return fmt.Errorf("scan legacy user identifiers: %w", err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate legacy user identifiers: %w", err)
	}
	if err := prepareMigratedUserIdentifiers(users); err != nil {
		return fmt.Errorf("audit legacy user identifiers: %w", err)
	}
	return nil
}

func migratedUsername(userID int64, username string) (string, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		if userID <= 0 {
			return "", fmt.Errorf("legacy user has invalid ID %d", userID)
		}
		username = "s2u-" + strconv.FormatInt(userID, 36)
	}
	if utf8.RuneCountInString(username) > 20 {
		return "", fmt.Errorf("legacy user %d username exceeds NewAPI's 20-character limit", userID)
	}
	return username, nil
}

func prepareMigratedUserIdentifiers(users []legacyUser) error {
	usernameOwners := make(map[string]int64, len(users))
	emailOwners := make(map[string]int64, len(users))

	for i := range users {
		username, err := migratedUsername(users[i].ID, users[i].Username)
		if err != nil {
			return err
		}
		email := strings.TrimSpace(users[i].Email)
		if email == "" {
			return fmt.Errorf("legacy user %d has an empty email", users[i].ID)
		}
		if utf8.RuneCountInString(email) > 50 {
			return fmt.Errorf("legacy user %d email exceeds NewAPI's 50-character limit", users[i].ID)
		}

		usernameKey := strings.ToLower(username)
		if owner, exists := usernameOwners[usernameKey]; exists && owner != users[i].ID {
			return fmt.Errorf("legacy users %d and %d have case-insensitive username collision %q", owner, users[i].ID, username)
		}
		emailKey := strings.ToLower(email)
		if owner, exists := emailOwners[emailKey]; exists && owner != users[i].ID {
			return fmt.Errorf("legacy users %d and %d have case-insensitive email collision %q", owner, users[i].ID, email)
		}

		users[i].Username = username
		users[i].Email = email
		usernameOwners[usernameKey] = users[i].ID
		emailOwners[emailKey] = users[i].ID
	}

	for _, user := range users {
		if owner, exists := emailOwners[strings.ToLower(user.Username)]; exists && owner != user.ID {
			return fmt.Errorf("legacy user %d username %q collides with legacy user %d email", user.ID, user.Username, owner)
		}
	}
	return nil
}

func validateLegacyUnsupportedState(
	frozenBalances int,
	userRPMLimits int,
	groupRPMLimits int,
	userGroupOverrides int,
	nonTokenPricing int,
	restrictedActiveGroups int,
	unsupportedActiveGroupPricing int,
) error {
	if frozenBalances != 0 {
		return fmt.Errorf("%d users have in-flight frozen balances; wait for billing settlement before migrating", frozenBalances)
	}
	if userRPMLimits != 0 {
		return fmt.Errorf("%d users have RPM limits that cannot be preserved through the shared legacy bridge", userRPMLimits)
	}
	if groupRPMLimits != 0 {
		return fmt.Errorf("%d active groups have RPM limits whose per-user semantics cannot be preserved through the shared legacy bridge", groupRPMLimits)
	}
	if userGroupOverrides != 0 {
		return fmt.Errorf("%d user-specific group rate or RPM overrides cannot be represented by NewAPI", userGroupOverrides)
	}
	if nonTokenPricing != 0 {
		return fmt.Errorf("%d non-token pricing records require an explicit NewAPI billing migration", nonTokenPricing)
	}
	if restrictedActiveGroups != 0 {
		return fmt.Errorf("%d active exclusive or subscription groups cannot be exposed as global NewAPI groups", restrictedActiveGroups)
	}
	if unsupportedActiveGroupPricing != 0 {
		return fmt.Errorf("%d active standard groups use peak, media-specific, or fixed image pricing that cannot be represented by NewAPI", unsupportedActiveGroupPricing)
	}
	return nil
}

func validateLegacyGroupAccessState(privilegedKeys int, allowedGroupAssignments int, activeSubscriptions int) error {
	if privilegedKeys != 0 {
		return fmt.Errorf("%d active API keys use exclusive or subscription groups that cannot be made globally accessible", privilegedKeys)
	}
	if allowedGroupAssignments != 0 {
		return fmt.Errorf("%d user-specific group authorizations cannot be represented by global NewAPI groups", allowedGroupAssignments)
	}
	if activeSubscriptions != 0 {
		return fmt.Errorf("%d active group subscriptions require an explicit entitlement migration", activeSubscriptions)
	}
	return nil
}

func loadMigrationData(ctx context.Context, source *sql.DB, sourceBaseURL string, bridgeBaseURL string) (*migrationData, error) {
	groups, err := loadBridgeGroups(ctx, source, sourceBaseURL, bridgeBaseURL)
	if err != nil {
		return nil, err
	}
	users, err := loadLegacyUsers(ctx, source)
	if err != nil {
		return nil, err
	}
	tokens, err := loadLegacyTokens(ctx, source)
	if err != nil {
		return nil, err
	}
	prices, err := loadLegacyPrices(ctx, source)
	if err != nil {
		return nil, err
	}
	settings, err := loadLegacySettings(ctx, source)
	if err != nil {
		return nil, err
	}
	options, err := buildTargetOptions(groups, prices, settings)
	if err != nil {
		return nil, err
	}
	return &migrationData{Users: users, Tokens: tokens, Groups: groups, Prices: prices, Options: options}, nil
}

func loadLegacyUsers(ctx context.Context, source *sql.DB) ([]legacyUser, error) {
	rows, err := source.QueryContext(ctx, `
		SELECT id, email, password_hash, role, balance::float8, concurrency, status, username, created_at, last_login_at
		FROM users
		WHERE deleted_at IS NULL AND email <> $1
		ORDER BY id
	`, bridgeUserEmail)
	if err != nil {
		return nil, fmt.Errorf("query legacy users: %w", err)
	}
	defer rows.Close()
	users := make([]legacyUser, 0)
	for rows.Next() {
		var user legacyUser
		if err := rows.Scan(
			&user.ID,
			&user.Email,
			&user.PasswordHash,
			&user.Role,
			&user.Balance,
			&user.Concurrency,
			&user.Status,
			&user.Username,
			&user.CreatedAt,
			&user.LastLoginAt,
		); err != nil {
			return nil, fmt.Errorf("scan legacy user: %w", err)
		}
		if user.Concurrency < 0 {
			return nil, fmt.Errorf("legacy user %d has invalid concurrency %d", user.ID, user.Concurrency)
		}
		if _, err := quotaFromUSD(user.Balance); err != nil {
			return nil, fmt.Errorf("legacy user %d balance: %w", user.ID, err)
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy users: %w", err)
	}
	if err := prepareMigratedUserIdentifiers(users); err != nil {
		return nil, fmt.Errorf("prepare legacy user identifiers: %w", err)
	}
	return users, nil
}

func loadLegacyTokens(ctx context.Context, source *sql.DB) ([]legacyToken, error) {
	rows, err := source.QueryContext(ctx, `
		SELECT
			k.id,
			k.user_id,
			k.key,
			k.name,
			g.name,
			(g.deleted_at IS NOT NULL),
			k.status,
			k.created_at,
			k.last_used_at,
			COALESCE(array_to_string(ARRAY(SELECT jsonb_array_elements_text(COALESCE(k.ip_whitelist, '[]'::jsonb))), E'\n'), ''),
			k.quota::float8,
			k.quota_used::float8,
			k.expires_at
		FROM api_keys k
		JOIN groups g ON g.id = k.group_id
		JOIN users u ON u.id = k.user_id
		WHERE k.deleted_at IS NULL
		  AND u.deleted_at IS NULL
		  AND u.email <> $1
		ORDER BY k.id
	`, bridgeUserEmail)
	if err != nil {
		return nil, fmt.Errorf("query legacy API keys: %w", err)
	}
	defer rows.Close()
	tokens := make([]legacyToken, 0)
	for rows.Next() {
		var token legacyToken
		if err := rows.Scan(
			&token.ID,
			&token.UserID,
			&token.Key,
			&token.Name,
			&token.GroupName,
			&token.GroupDeleted,
			&token.Status,
			&token.CreatedAt,
			&token.LastUsedAt,
			&token.IPWhitelist,
			&token.Quota,
			&token.QuotaUsed,
			&token.ExpiresAt,
		); err != nil {
			return nil, fmt.Errorf("scan legacy API key: %w", err)
		}
		if _, err := normalizedLegacyKey(token.Key); err != nil {
			return nil, fmt.Errorf("legacy API key %d: %w", token.ID, err)
		}
		tokens = append(tokens, token)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy API keys: %w", err)
	}
	return tokens, nil
}

func loadBridgeGroups(ctx context.Context, source *sql.DB, sourceBaseURL string, bridgeBaseURL string) ([]bridgeGroup, error) {
	rows, err := source.QueryContext(ctx, `
		SELECT
			g.id,
			g.name,
			g.rate_multiplier::float8,
			(g.deleted_at IS NOT NULL),
			g.status,
			g.is_exclusive,
			g.subscription_type
		FROM groups g
		ORDER BY g.id
	`)
	if err != nil {
		return nil, fmt.Errorf("query legacy groups: %w", err)
	}
	defer rows.Close()
	groups := make([]bridgeGroup, 0)
	for rows.Next() {
		var group bridgeGroup
		var deleted bool
		var status string
		var exclusive bool
		var subscriptionType string
		if err := rows.Scan(
			&group.ID,
			&group.Name,
			&group.RateMultiplier,
			&deleted,
			&status,
			&exclusive,
			&subscriptionType,
		); err != nil {
			return nil, fmt.Errorf("scan legacy group: %w", err)
		}
		if !shouldMigrateGlobalGroup(deleted, status, exclusive, subscriptionType) {
			continue
		}
		if group.Name == "" || len(group.Name) > 64 || strings.Contains(group.Name, ",") {
			return nil, fmt.Errorf("legacy group %d has an unsupported name %q", group.ID, group.Name)
		}
		group.BridgeBaseURL = bridgeBaseURL
		groups = append(groups, group)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy groups: %w", err)
	}
	if len(groups) == 0 {
		return nil, errors.New("legacy database has no active groups")
	}

	bridgeUserID, err := ensureBridgeUser(ctx, source)
	if err != nil {
		return nil, err
	}
	for i := range groups {
		bridgeKey, err := ensureBridgeKey(ctx, source, bridgeUserID, groups[i])
		if err != nil {
			return nil, err
		}
		groups[i].BridgeKey = bridgeKey
		models, err := fetchGroupModels(ctx, sourceBaseURL, bridgeKey)
		if err != nil {
			return nil, fmt.Errorf("fetch models for legacy group %q: %w", groups[i].Name, err)
		}
		groups[i].Models = models
	}
	return groups, nil
}

func shouldMigrateGlobalGroup(deleted bool, status string, exclusive bool, subscriptionType string) bool {
	return !deleted && status == "active" && !exclusive && subscriptionType == "standard"
}

func ensureBridgeUser(ctx context.Context, source *sql.DB) (int64, error) {
	var userID int64
	err := source.QueryRowContext(ctx, `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`, bridgeUserEmail).Scan(&userID)
	if err == nil {
		return userID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("query bridge user: %w", err)
	}
	password, err := randomHex(32)
	if err != nil {
		return 0, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return 0, fmt.Errorf("hash bridge password: %w", err)
	}
	err = source.QueryRowContext(ctx, `
		INSERT INTO users (
			email, password_hash, role, balance, frozen_balance, concurrency, status,
			username, notes, signup_source, created_at, updated_at
		)
		VALUES ($1, $2, 'user', $3, 0, 1000, 'active', 'newapi-bridge', 'Internal NewAPI compatibility bridge', 'email', now(), now())
		RETURNING id
	`, bridgeUserEmail, string(hash), bridgeUserBalance).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("create bridge user: %w", err)
	}
	return userID, nil
}

func ensureBridgeKey(ctx context.Context, source *sql.DB, userID int64, group bridgeGroup) (string, error) {
	name := fmt.Sprintf("__newapi_bridge_group_%d", group.ID)
	var key string
	err := source.QueryRowContext(ctx, `
		SELECT key
		FROM api_keys
		WHERE user_id = $1 AND name = $2 AND deleted_at IS NULL
		ORDER BY id
		LIMIT 1
	`, userID, name).Scan(&key)
	if err == nil {
		return key, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("query bridge key for group %q: %w", group.Name, err)
	}
	randomKey, err := randomHex(32)
	if err != nil {
		return "", err
	}
	key = "sk-" + randomKey
	_, err = source.ExecContext(ctx, `
		INSERT INTO api_keys (
			user_id, key, name, group_id, status, created_at, updated_at,
			ip_whitelist, ip_blacklist, quota, quota_used,
			rate_limit_5h, rate_limit_1d, rate_limit_7d,
			usage_5h, usage_1d, usage_7d
		)
		VALUES ($1, $2, $3, $4, 'active', now(), now(), '[]'::jsonb, '[]'::jsonb, 0, 0, 0, 0, 0, 0, 0, 0)
	`, userID, key, name, group.ID)
	if err != nil {
		return "", fmt.Errorf("create bridge key for group %q: %w", group.Name, err)
	}
	return key, nil
}

func fetchGroupModels(ctx context.Context, sourceBaseURL string, apiKey string) ([]string, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, sourceBaseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil, fmt.Errorf("legacy model endpoint returned HTTP %d", resp.StatusCode)
	}
	var payload modelListResponse
	if err := common.DecodeJson(resp.Body, &payload); err != nil {
		return nil, fmt.Errorf("decode model list: %w", err)
	}
	seen := make(map[string]struct{}, len(payload.Data))
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		model := strings.TrimSpace(item.ID)
		if model == "" || len(model) > 255 || strings.Contains(model, ",") {
			return nil, fmt.Errorf("legacy model endpoint returned unsupported model %q", model)
		}
		if _, exists := seen[model]; exists {
			continue
		}
		seen[model] = struct{}{}
		models = append(models, model)
	}
	if len(models) == 0 {
		return nil, errors.New("legacy model endpoint returned no models")
	}
	sort.Strings(models)
	return models, nil
}

func loadLegacyPrices(ctx context.Context, source *sql.DB) ([]legacyPrice, error) {
	rows, err := source.QueryContext(ctx, `
		SELECT
			cmp.id,
			model_name,
			cmp.input_price::float8,
			cmp.output_price::float8,
			COALESCE(cmp.cache_write_price, 0)::float8,
			COALESCE(cmp.cache_read_price, 0)::float8
		FROM channel_model_pricing cmp
		CROSS JOIN LATERAL jsonb_array_elements_text(cmp.models) AS model_name
		WHERE cmp.billing_mode = 'token'
		ORDER BY model_name, cmp.id
	`)
	if err != nil {
		return nil, fmt.Errorf("query legacy pricing: %w", err)
	}
	defer rows.Close()
	type pricingRecord struct {
		ID    int64
		Price legacyPrice
	}
	records := make([]pricingRecord, 0)
	for rows.Next() {
		var record pricingRecord
		if err := rows.Scan(
			&record.ID,
			&record.Price.Model,
			&record.Price.InputPrice,
			&record.Price.OutputPrice,
			&record.Price.CacheWritePrice,
			&record.Price.CacheReadPrice,
		); err != nil {
			return nil, fmt.Errorf("scan legacy pricing: %w", err)
		}
		if !validLegacyPrice(record.Price.InputPrice, false) ||
			!validLegacyPrice(record.Price.OutputPrice, true) ||
			!validLegacyPrice(record.Price.CacheWritePrice, true) ||
			!validLegacyPrice(record.Price.CacheReadPrice, true) {
			return nil, fmt.Errorf("legacy model %q has invalid token pricing", record.Price.Model)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy pricing: %w", err)
	}

	intervalRows, err := source.QueryContext(ctx, `
		SELECT
			i.pricing_id,
			i.min_tokens,
			i.max_tokens,
			COALESCE(i.input_price, 0)::float8,
			COALESCE(i.output_price, 0)::float8,
			COALESCE(i.cache_write_price, 0)::float8,
			COALESCE(i.cache_read_price, 0)::float8
		FROM channel_pricing_intervals i
		JOIN channel_model_pricing cmp ON cmp.id = i.pricing_id
		WHERE cmp.billing_mode = 'token'
		ORDER BY i.pricing_id, i.sort_order, i.id
	`)
	if err != nil {
		return nil, fmt.Errorf("query legacy pricing intervals: %w", err)
	}
	defer intervalRows.Close()
	intervalsByPricingID := make(map[int64][]legacyPriceInterval)
	for intervalRows.Next() {
		var pricingID int64
		var maxTokens sql.NullInt64
		var interval legacyPriceInterval
		if err := intervalRows.Scan(
			&pricingID,
			&interval.MinTokens,
			&maxTokens,
			&interval.InputPrice,
			&interval.OutputPrice,
			&interval.CacheWritePrice,
			&interval.CacheReadPrice,
		); err != nil {
			return nil, fmt.Errorf("scan legacy pricing interval: %w", err)
		}
		if maxTokens.Valid {
			value := int(maxTokens.Int64)
			interval.MaxTokens = &value
		}
		if interval.MinTokens < 0 ||
			(interval.MaxTokens != nil && *interval.MaxTokens <= interval.MinTokens) ||
			!validLegacyPrice(interval.InputPrice, true) ||
			!validLegacyPrice(interval.OutputPrice, true) ||
			!validLegacyPrice(interval.CacheWritePrice, true) ||
			!validLegacyPrice(interval.CacheReadPrice, true) {
			return nil, fmt.Errorf("legacy pricing %d has an invalid token interval", pricingID)
		}
		intervalsByPricingID[pricingID] = append(intervalsByPricingID[pricingID], interval)
	}
	if err := intervalRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy pricing intervals: %w", err)
	}

	pricesByModel := make(map[string]legacyPrice)
	for _, record := range records {
		record.Price.Intervals = intervalsByPricingID[record.ID]
		if previous, exists := pricesByModel[record.Price.Model]; exists && !sameLegacyPrice(previous, record.Price) {
			return nil, fmt.Errorf("legacy model %q has conflicting channel-specific prices", record.Price.Model)
		}
		pricesByModel[record.Price.Model] = record.Price
	}
	models := make([]string, 0, len(pricesByModel))
	for model := range pricesByModel {
		models = append(models, model)
	}
	sort.Strings(models)
	prices := make([]legacyPrice, 0, len(models))
	for _, model := range models {
		prices = append(prices, pricesByModel[model])
	}
	return prices, nil
}

func validLegacyPrice(value float64, allowZero bool) bool {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return false
	}
	return allowZero || value > 0
}

func sameLegacyPrice(left legacyPrice, right legacyPrice) bool {
	if left.Model != right.Model ||
		left.InputPrice != right.InputPrice ||
		left.OutputPrice != right.OutputPrice ||
		left.CacheWritePrice != right.CacheWritePrice ||
		left.CacheReadPrice != right.CacheReadPrice ||
		len(left.Intervals) != len(right.Intervals) {
		return false
	}
	for i := range left.Intervals {
		leftInterval := left.Intervals[i]
		rightInterval := right.Intervals[i]
		if leftInterval.MinTokens != rightInterval.MinTokens ||
			leftInterval.InputPrice != rightInterval.InputPrice ||
			leftInterval.OutputPrice != rightInterval.OutputPrice ||
			leftInterval.CacheWritePrice != rightInterval.CacheWritePrice ||
			leftInterval.CacheReadPrice != rightInterval.CacheReadPrice ||
			(leftInterval.MaxTokens == nil) != (rightInterval.MaxTokens == nil) {
			return false
		}
		if leftInterval.MaxTokens != nil && *leftInterval.MaxTokens != *rightInterval.MaxTokens {
			return false
		}
	}
	return true
}

func loadLegacySettings(ctx context.Context, source *sql.DB) (map[string]string, error) {
	rows, err := source.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, fmt.Errorf("query legacy settings: %w", err)
	}
	defer rows.Close()
	settings := make(map[string]string)
	for rows.Next() {
		var key string
		var value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("scan legacy setting: %w", err)
		}
		settings[key] = value
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy settings: %w", err)
	}
	return settings, nil
}

func buildTargetOptions(groups []bridgeGroup, prices []legacyPrice, source map[string]string) (map[string]string, error) {
	ratio_setting.InitRatioSettings()
	modelRatio := ratio_setting.GetModelRatioCopy()
	modelPrice := ratio_setting.GetModelPriceCopy()
	completionRatio := ratio_setting.GetCompletionRatioCopy()
	cacheRatio := ratio_setting.GetCacheRatioCopy()
	createCacheRatio := ratio_setting.GetCreateCacheRatioCopy()
	billingMode := make(map[string]string, len(prices))
	billingExpr := make(map[string]string, len(prices))
	for _, price := range prices {
		// A migrated Sub2API token price must take precedence over NewAPI's
		// built-in fixed-per-request entries for the same model.
		delete(modelPrice, price.Model)
		modelRatio[price.Model] = price.InputPrice * quotaPerUSD
		completionRatio[price.Model] = price.OutputPrice / price.InputPrice
		cacheRatio[price.Model] = price.CacheReadPrice / price.InputPrice
		createCacheRatio[price.Model] = price.CacheWritePrice / price.InputPrice
		expression, err := buildLegacyBillingExpr(price)
		if err != nil {
			return nil, fmt.Errorf("build billing expression for legacy model %q: %w", price.Model, err)
		}
		billingMode[price.Model] = billing_setting.BillingModeTieredExpr
		billingExpr[price.Model] = expression
	}

	groupRatio := map[string]float64{"default": 1}
	usableGroups := map[string]string{"auto": "Auto", "default": "Default"}
	autoGroups := make([]string, 0, len(groups))
	for _, group := range groups {
		groupRatio[group.Name] = group.RateMultiplier
		usableGroups[group.Name] = group.Name
		autoGroups = append(autoGroups, group.Name)
	}

	marshal := func(value any) (string, error) {
		encoded, err := common.Marshal(value)
		if err != nil {
			return "", err
		}
		return string(encoded), nil
	}
	modelRatioJSON, err := marshal(modelRatio)
	if err != nil {
		return nil, fmt.Errorf("encode model ratios: %w", err)
	}
	modelPriceJSON, err := marshal(modelPrice)
	if err != nil {
		return nil, fmt.Errorf("encode model prices: %w", err)
	}
	completionRatioJSON, err := marshal(completionRatio)
	if err != nil {
		return nil, fmt.Errorf("encode completion ratios: %w", err)
	}
	cacheRatioJSON, err := marshal(cacheRatio)
	if err != nil {
		return nil, fmt.Errorf("encode cache ratios: %w", err)
	}
	createCacheRatioJSON, err := marshal(createCacheRatio)
	if err != nil {
		return nil, fmt.Errorf("encode cache creation ratios: %w", err)
	}
	billingModeJSON, err := marshal(billingMode)
	if err != nil {
		return nil, fmt.Errorf("encode billing modes: %w", err)
	}
	billingExprJSON, err := marshal(billingExpr)
	if err != nil {
		return nil, fmt.Errorf("encode billing expressions: %w", err)
	}
	groupRatioJSON, err := marshal(groupRatio)
	if err != nil {
		return nil, fmt.Errorf("encode group ratios: %w", err)
	}
	usableGroupsJSON, err := marshal(usableGroups)
	if err != nil {
		return nil, fmt.Errorf("encode usable groups: %w", err)
	}
	autoGroupsJSON, err := marshal(autoGroups)
	if err != nil {
		return nil, fmt.Errorf("encode automatic groups: %w", err)
	}

	options := map[string]string{
		"QuotaPerUnit":                              "500000",
		"ModelRatio":                                modelRatioJSON,
		"ModelPrice":                                modelPriceJSON,
		"CompletionRatio":                           completionRatioJSON,
		"CacheRatio":                                cacheRatioJSON,
		"CreateCacheRatio":                          createCacheRatioJSON,
		"billing_setting.billing_mode":              billingModeJSON,
		"billing_setting.billing_expr":              billingExprJSON,
		"GroupRatio":                                groupRatioJSON,
		"UserUsableGroups":                          usableGroupsJSON,
		"AutoGroups":                                autoGroupsJSON,
		"DefaultUseAutoGroup":                       "true",
		"RegisterEnabled":                           settingOrDefault(source, "registration_enabled", "true"),
		"PasswordRegisterEnabled":                   "true",
		"EmailVerificationEnabled":                  settingOrDefault(source, "email_verify_enabled", "false"),
		"regional_restriction.enabled":              settingOrDefault(source, "regional_restriction_enabled", "true"),
		"regional_restriction.registration_enabled": settingOrDefault(source, "regional_restriction_registration_enabled", "true"),
		"regional_restriction.oauth_signup_enabled": settingOrDefault(source, "regional_restriction_oauth_signup_enabled", "true"),
		"regional_restriction.api_key_page_confirmation_enabled": settingOrDefault(source, "regional_restriction_api_key_page_confirmation_enabled", "true"),
		"regional_restriction.api_key_create_enabled":            settingOrDefault(source, "regional_restriction_api_key_create_enabled", "true"),
		"regional_restriction.blocked_country_codes":             settingOrDefault(source, "regional_restriction_blocked_country_codes", `["CN"]`),
		"regional_restriction.unknown_region_policy":             settingOrDefault(source, "regional_restriction_unknown_region_policy", "allow"),
		"regional_restriction.confirmation_frequency":            settingOrDefault(source, "regional_restriction_confirmation_frequency", "once_per_revision"),
		"regional_restriction.confirmation_revision":             settingOrDefault(source, "regional_restriction_confirmation_revision", "2026-08-03"),
		"regional_restriction.confirmation_interval_hours":       settingOrDefault(source, "regional_restriction_confirmation_interval_hours", "24"),
	}
	return options, nil
}

func buildLegacyBillingExpr(price legacyPrice) (string, error) {
	baseCost, err := legacyTokenCostExpr(
		price.InputPrice,
		price.OutputPrice,
		price.CacheWritePrice,
		price.CacheReadPrice,
	)
	if err != nil {
		return "", err
	}
	expression := fmt.Sprintf(`tier("sub2api_fallback", %s)`, baseCost)
	if len(price.Intervals) == 0 {
		expression = fmt.Sprintf(`tier("sub2api", %s)`, baseCost)
	} else {
		for i, interval := range price.Intervals {
			if i == 0 && interval.MinTokens != 0 {
				return "", fmt.Errorf("first interval starts at %d, expected 0", interval.MinTokens)
			}
			if i > 0 {
				previous := price.Intervals[i-1]
				if previous.MaxTokens == nil {
					return "", fmt.Errorf("interval %d follows an unbounded interval", i+1)
				}
				if *previous.MaxTokens != interval.MinTokens {
					return "", fmt.Errorf(
						"interval %d starts at %d after previous maximum %d; gaps and overlaps cannot preserve Sub2API billing",
						i+1,
						interval.MinTokens,
						*previous.MaxTokens,
					)
				}
			}
			if interval.MaxTokens != nil && *interval.MaxTokens <= interval.MinTokens {
				return "", fmt.Errorf("interval %d has an invalid maximum", i+1)
			}
		}
		if price.Intervals[len(price.Intervals)-1].MaxTokens != nil {
			return "", errors.New("last interval must be unbounded to preserve Sub2API fallback behavior")
		}

		for i := len(price.Intervals) - 1; i >= 0; i-- {
			interval := price.Intervals[i]
			cost, err := legacyTokenCostExpr(
				interval.InputPrice,
				interval.OutputPrice,
				interval.CacheWritePrice,
				interval.CacheReadPrice,
			)
			if err != nil {
				return "", fmt.Errorf("interval %d: %w", i+1, err)
			}
			condition := "len > " + strconv.Itoa(interval.MinTokens)
			if interval.MaxTokens != nil {
				condition += " && len <= " + strconv.Itoa(*interval.MaxTokens)
			}
			expression = fmt.Sprintf(
				`(%s) ? tier("sub2api_%d", %s) : (%s)`,
				condition,
				i+1,
				cost,
				expression,
			)
		}
	}
	if _, err := billingexpr.CompileFromCache(expression); err != nil {
		return "", fmt.Errorf("compile generated expression: %w", err)
	}
	return expression, nil
}

func legacyTokenCostExpr(inputPrice float64, outputPrice float64, cacheWritePrice float64, cacheReadPrice float64) (string, error) {
	prices := []float64{inputPrice, outputPrice, cacheWritePrice, cacheReadPrice}
	coefficients := make([]string, len(prices))
	for i, price := range prices {
		if !validLegacyPrice(price, true) {
			return "", fmt.Errorf("invalid per-token price %v", price)
		}
		coefficients[i] = decimal.NewFromFloat(price).
			Mul(decimal.NewFromInt(1_000_000)).
			String()
	}
	return fmt.Sprintf(
		"p * %s + c * %s + cr * %s + cc * %s + cc1h * %s",
		coefficients[0],
		coefficients[1],
		coefficients[3],
		coefficients[2],
		coefficients[2],
	), nil
}

func settingOrDefault(settings map[string]string, key string, fallback string) string {
	value := strings.TrimSpace(settings[key])
	if value == "" {
		return fallback
	}
	return value
}

func migrateTarget(ctx context.Context, target *sql.DB, data *migrationData, version string) error {
	tx, err := target.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin target migration: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext('newapi-sub2api-migration'))`); err != nil {
		return fmt.Errorf("lock target migration: %w", err)
	}
	var existingMarker string
	err = tx.QueryRowContext(ctx, `SELECT value FROM options WHERE key = $1`, migrationOptionKey).Scan(&existingMarker)
	if err == nil {
		return fmt.Errorf("target migration marker appeared concurrently: %q", existingMarker)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("recheck target migration marker: %w", err)
	}

	for _, user := range data.Users {
		quota, err := quotaFromUSD(user.Balance)
		if err != nil {
			return fmt.Errorf("convert balance for legacy user %d: %w", user.ID, err)
		}
		role := 1
		if user.Role == "admin" {
			role = 100
		}
		status := 1
		if user.Status != "active" {
			status = 2
		}
		lastLogin := int64(0)
		if user.LastLoginAt.Valid {
			lastLogin = user.LastLoginAt.Time.Unix()
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO users (
				id, username, password, display_name, role, status, email,
				github_id, discord_id, oidc_id, wechat_id, telegram_id, linux_do_id,
				quota, relay_concurrency, used_quota, request_count, "group", aff_code, aff_count,
				aff_quota, aff_history, inviter_id, setting, created_at,
				last_login_at, auth_version
			)
			VALUES (
				$1, $2, $3, $2, $4, $5, $6,
				'', '', '', '', '', '',
				$7, $8, 0, 0, 'default', $9, 0,
				0, 0, 0, '{}', $10, $11, 1
			)
		`,
			user.ID,
			user.Username,
			user.PasswordHash,
			role,
			status,
			user.Email,
			quota,
			user.Concurrency,
			fmt.Sprintf("legacy%08d", user.ID),
			user.CreatedAt.Unix(),
			lastLogin,
		)
		if err != nil {
			return fmt.Errorf("insert legacy user %d: %w", user.ID, err)
		}
	}

	for _, token := range data.Tokens {
		key, err := normalizedLegacyKey(token.Key)
		if err != nil {
			return fmt.Errorf("normalize legacy API key %d: %w", token.ID, err)
		}
		status := migratedTokenStatus(token)
		unlimited := token.Quota <= 0
		remainQuota := 0
		usedQuota, err := quotaFromUSD(token.QuotaUsed)
		if err != nil {
			return fmt.Errorf("convert used quota for legacy API key %d: %w", token.ID, err)
		}
		if !unlimited {
			totalQuota, err := quotaFromUSD(token.Quota)
			if err != nil {
				return fmt.Errorf("convert quota for legacy API key %d: %w", token.ID, err)
			}
			remainQuota = totalQuota - usedQuota
			if remainQuota < 0 {
				remainQuota = 0
			}
		}
		expiredTime := int64(-1)
		if token.ExpiresAt.Valid {
			expiredTime = token.ExpiresAt.Time.Unix()
		}
		accessedTime := token.CreatedAt.Unix()
		if token.LastUsedAt.Valid {
			accessedTime = token.LastUsedAt.Time.Unix()
		}
		_, err = tx.ExecContext(ctx, `
			INSERT INTO tokens (
				id, user_id, key, status, name, created_time, accessed_time,
				expired_time, remain_quota, unlimited_quota, model_limits_enabled,
				model_limits, allow_ips, used_quota, "group", cross_group_retry,
				auto_groups
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, '', $11, $12, $13, false, '')
		`,
			token.ID,
			token.UserID,
			key,
			status,
			token.Name,
			token.CreatedAt.Unix(),
			accessedTime,
			expiredTime,
			remainQuota,
			unlimited,
			token.IPWhitelist,
			usedQuota,
			token.GroupName,
		)
		if err != nil {
			return fmt.Errorf("insert legacy API key %d: %w", token.ID, err)
		}
	}

	for _, group := range data.Groups {
		tag := fmt.Sprintf("sub2api-bridge:%d", group.ID)
		var channelID int
		err := tx.QueryRowContext(ctx, `
			INSERT INTO channels (
				type, key, status, name, weight, created_time, test_time,
				response_time, base_url, other, balance, balance_updated_time,
				models, "group", used_quota, model_mapping, status_code_mapping,
				priority, auto_ban, other_info, tag, setting, param_override,
				header_override, channel_info, settings
			)
			VALUES (
				$1, $2, 1, $3, 0, $4, 0,
				0, $5, '', 0, 0,
				$6, $7, 0, NULL, NULL,
				0, 0, '', $8, NULL, NULL,
				NULL, '{}'::json, ''
			)
			RETURNING id
		`,
			constant.ChannelTypeSub2API,
			group.BridgeKey,
			"Legacy bridge - "+group.Name,
			time.Now().Unix(),
			group.BridgeBaseURL,
			strings.Join(group.Models, ","),
			group.Name,
			tag,
		).Scan(&channelID)
		if err != nil {
			return fmt.Errorf("insert bridge channel for group %q: %w", group.Name, err)
		}
		for _, model := range group.Models {
			_, err := tx.ExecContext(ctx, `
				INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
				VALUES ($1, $2, $3, true, 0, 0, $4)
			`, group.Name, model, channelID, tag)
			if err != nil {
				return fmt.Errorf("insert ability for group %q model %q: %w", group.Name, model, err)
			}
		}
	}

	optionKeys := make([]string, 0, len(data.Options))
	for key := range data.Options {
		optionKeys = append(optionKeys, key)
	}
	sort.Strings(optionKeys)
	for _, key := range optionKeys {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO options (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
		`, key, data.Options[key])
		if err != nil {
			return fmt.Errorf("write target option %q: %w", key, err)
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO setups (version, initialized_at)
		SELECT 'sub2api-migration', $1
		WHERE NOT EXISTS (SELECT 1 FROM setups)
	`, time.Now().Unix())
	if err != nil {
		return fmt.Errorf("initialize target setup state: %w", err)
	}
	for _, table := range []string{"users", "tokens", "channels", "setups"} {
		statement := fmt.Sprintf(
			"SELECT setval(pg_get_serial_sequence('%s', 'id'), COALESCE((SELECT max(id) FROM %s), 1), (SELECT count(*) > 0 FROM %s))",
			table,
			table,
			table,
		)
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("advance %s id sequence: %w", table, err)
		}
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO options (key, value) VALUES ($1, $2)`, migrationOptionKey, version); err != nil {
		return fmt.Errorf("write migration marker: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit target migration: %w", err)
	}
	return nil
}

func migratedTokenStatus(token legacyToken) int {
	if token.Status == "active" && !token.GroupDeleted {
		return 1
	}
	return 2
}

func quotaFromUSD(value float64) (int, error) {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, fmt.Errorf("invalid USD value %v", value)
	}
	quota := math.Round(value * quotaPerUSD)
	if quota > math.MaxInt32 {
		return 0, fmt.Errorf("USD value %.8f exceeds NewAPI quota capacity", value)
	}
	return int(quota), nil
}

func normalizedLegacyKey(key string) (string, error) {
	key = strings.TrimSpace(key)
	if !strings.HasPrefix(key, "sk-") {
		return "", errors.New("key does not use the sk- prefix")
	}
	key = strings.TrimPrefix(key, "sk-")
	if key == "" || len(key) > 128 || strings.Contains(key, "-") {
		return "", errors.New("key body is empty, too long, or contains a delimiter")
	}
	return key, nil
}

func randomHex(bytes int) (string, error) {
	buffer := make([]byte, bytes)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate random secret: %w", err)
	}
	return hex.EncodeToString(buffer), nil
}
