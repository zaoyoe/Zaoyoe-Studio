package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const (
	nativeSchedulerImportEnv         = "NATIVE_SCHEDULER_IMPORT"
	nativeSchedulerAllowSkipsEnv     = "NATIVE_SCHEDULER_ALLOW_SKIPS"
	nativeSchedulerImportLockQuery   = `SELECT pg_advisory_xact_lock(hashtext('newapi-native-scheduler-import'))`
	nativeSchedulerCredentialQuery   = `SELECT id, type, credentials FROM accounts WHERE deleted_at IS NULL AND id = ANY($1) ORDER BY id`
	nativeSchedulerManagedChannelSQL = `SELECT id, type FROM channels WHERE tag = $1 ORDER BY id`
)

// nativeSchedulerImportCredential is intentionally not serializable. Credentials
// are read into memory only long enough to write channels.key and are never part
// of a plan, report, or error message.
type nativeSchedulerImportCredential struct {
	AccountID int64  `json:"-"`
	AuthType  string `json:"-"`
	Key       string `json:"-"`
}

type nativeSchedulerImportReport struct {
	ImportedChannels int
	CreatedChannels  int
	UpdatedChannels  int
	Abilities        int
	Skipped          int
}

func isNativeSchedulerImport(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func runNativeSchedulerImport(ctx context.Context) error {
	sourceDSN, err := requiredEnv("SOURCE_SQL_DSN")
	if err != nil {
		return err
	}
	targetDSN, err := requiredEnv("TARGET_SQL_DSN")
	if err != nil {
		return err
	}

	source, err := openDatabase(ctx, sourceDSN)
	if err != nil {
		return fmt.Errorf("open source database for native scheduler import: %w", err)
	}
	defer source.Close()
	target, err := openDatabase(ctx, targetDSN)
	if err != nil {
		return fmt.Errorf("open target database for native scheduler import: %w", err)
	}
	defer target.Close()

	groupIDs, err := parseNativeSchedulerGroupIDs(strings.TrimSpace(os.Getenv(nativeSchedulerGroupEnv)))
	if err != nil {
		return err
	}
	if len(groupIDs) == 0 {
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
	if plan.Report.Skipped != 0 && !isNativeSchedulerImport(os.Getenv(nativeSchedulerAllowSkipsEnv)) {
		return fmt.Errorf("native scheduler plan skipped %d accounts; set %s=true only after reviewing the plan report", plan.Report.Skipped, nativeSchedulerAllowSkipsEnv)
	}
	credentials, err := loadLegacyNativeSchedulerCredentials(ctx, source, plan.Channels)
	if err != nil {
		return err
	}
	report, err := importNativeSchedulerPlan(ctx, target, plan, credentials)
	if err != nil {
		return err
	}
	fmt.Printf(
		"Native scheduler import completed: %d channels (%d created, %d updated), %d abilities, %d skipped.\n",
		report.ImportedChannels, report.CreatedChannels, report.UpdatedChannels, report.Abilities, report.Skipped,
	)
	return nil
}

func loadLegacyNativeSchedulerCredentials(ctx context.Context, source *sql.DB, channels []nativeChannelPlan) (map[int64]nativeSchedulerImportCredential, error) {
	accountIDs := make([]int64, 0, len(channels))
	seen := make(map[int64]struct{}, len(channels))
	for _, channel := range channels {
		if channel.SourceAccountID <= 0 {
			return nil, fmt.Errorf("native scheduler channel has invalid source account id %d", channel.SourceAccountID)
		}
		if _, exists := seen[channel.SourceAccountID]; exists {
			continue
		}
		seen[channel.SourceAccountID] = struct{}{}
		accountIDs = append(accountIDs, channel.SourceAccountID)
	}
	if len(accountIDs) == 0 {
		return map[int64]nativeSchedulerImportCredential{}, nil
	}
	rows, err := source.QueryContext(ctx, nativeSchedulerCredentialQuery, postgresInt64Array(accountIDs))
	if err != nil {
		return nil, fmt.Errorf("query legacy credentials for native scheduler import: %w", err)
	}
	defer rows.Close()

	credentials := make(map[int64]nativeSchedulerImportCredential)
	for rows.Next() {
		var id sql.NullInt64
		var authType sql.NullString
		var raw []byte
		if err := rows.Scan(&id, &authType, &raw); err != nil {
			return nil, fmt.Errorf("scan legacy credential for native scheduler import: %w", err)
		}
		if !id.Valid || id.Int64 <= 0 {
			return nil, errors.New("legacy credential row has no valid account id")
		}
		value, err := decodeLegacyPlanJSON(raw, "credentials", id.Int64)
		if err != nil {
			return nil, err
		}
		key := nativeSchedulerCredentialValue(value, authType.String)
		if key != "" {
			credentials[id.Int64] = nativeSchedulerImportCredential{
				AccountID: id.Int64,
				AuthType:  strings.ToLower(strings.TrimSpace(authType.String)),
				Key:       key,
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy credentials for native scheduler import: %w", err)
	}
	return credentials, nil
}

func nativeSchedulerCredentialValue(credentials map[string]any, authType string) string {
	// Native NewAPI channels currently have a verified mapping only for the
	// legacy API-key/upstream account types. Do not fall back to access or
	// refresh tokens, setup tokens, or arbitrary credential values.
	switch strings.ToLower(strings.TrimSpace(authType)) {
	case "apikey", "api_key", "upstream":
	default:
		return ""
	}
	for _, key := range []string{"api_key", "apiKey", "key"} {
		if value := strings.TrimSpace(stringValue(credentials[key])); value != "" {
			return value
		}
	}
	return ""
}

func importNativeSchedulerPlan(
	ctx context.Context,
	target *sql.DB,
	plan nativeSchedulerPlan,
	credentials map[int64]nativeSchedulerImportCredential,
) (nativeSchedulerImportReport, error) {
	if target == nil {
		return nativeSchedulerImportReport{}, errors.New("target database is required for native scheduler import")
	}
	for _, channel := range plan.Channels {
		if _, err := validateNativeModelMapping(cloneStringMap(channel.ModelMapping)); err != nil {
			return nativeSchedulerImportReport{}, fmt.Errorf("legacy account %d model_mapping: %w", channel.SourceAccountID, err)
		}
		if err := validateNativeChannelBaseURL(channel.BaseURL); err != nil {
			return nativeSchedulerImportReport{}, fmt.Errorf("legacy account %d base_url: %w", channel.SourceAccountID, err)
		}
	}

	report := nativeSchedulerImportReport{Skipped: plan.Report.Skipped}
	tx, err := target.BeginTx(ctx, nil)
	if err != nil {
		return report, fmt.Errorf("begin native scheduler import: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, nativeSchedulerImportLockQuery); err != nil {
		return report, fmt.Errorf("lock native scheduler import: %w", err)
	}

	for _, channel := range plan.Channels {
		credential, ok := credentials[channel.SourceAccountID]
		if !ok || credential.Key == "" {
			return report, fmt.Errorf("legacy account %d has no usable credential for native scheduler import", channel.SourceAccountID)
		}
		if credential.AccountID != 0 && credential.AccountID != channel.SourceAccountID {
			return report, fmt.Errorf("credential account mismatch for legacy account %d", channel.SourceAccountID)
		}
		if credential.AuthType != strings.ToLower(strings.TrimSpace(channel.AuthType)) {
			return report, fmt.Errorf("credential type mismatch for legacy account %d", channel.SourceAccountID)
		}

		channelID, created, err := upsertNativeSchedulerChannel(ctx, tx, channel, credential.Key)
		if err != nil {
			return report, err
		}
		if created {
			report.CreatedChannels++
		} else {
			report.UpdatedChannels++
		}
		abilityCount, err := replaceNativeSchedulerAbilities(ctx, tx, channel, channelID)
		if err != nil {
			return report, err
		}
		report.ImportedChannels++
		report.Abilities += abilityCount
	}

	if err := tx.Commit(); err != nil {
		return report, fmt.Errorf("commit native scheduler import: %w", err)
	}
	return report, nil
}

func upsertNativeSchedulerChannel(ctx context.Context, tx *sql.Tx, channel nativeChannelPlan, key string) (int, bool, error) {
	if channel.SourceAccountID <= 0 {
		return 0, false, errors.New("native scheduler channel has invalid source account id")
	}
	tag := nativeSchedulerChannelTag(channel.SourceAccountID)
	rows, err := tx.QueryContext(ctx, nativeSchedulerManagedChannelSQL, tag)
	if err != nil {
		return 0, false, fmt.Errorf("find native scheduler channel for account %d: %w", channel.SourceAccountID, err)
	}
	var ids []int
	var types []int
	for rows.Next() {
		var id int
		var channelType int
		if err := rows.Scan(&id, &channelType); err != nil {
			rows.Close()
			return 0, false, fmt.Errorf("scan native scheduler channel for account %d: %w", channel.SourceAccountID, err)
		}
		ids = append(ids, id)
		types = append(types, channelType)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, false, fmt.Errorf("iterate native scheduler channels for account %d: %w", channel.SourceAccountID, err)
	}
	if err := rows.Close(); err != nil {
		return 0, false, fmt.Errorf("close native scheduler channels for account %d: %w", channel.SourceAccountID, err)
	}
	if len(ids) > 1 {
		return 0, false, fmt.Errorf("multiple native scheduler channels found for legacy account %d", channel.SourceAccountID)
	}
	if len(types) == 1 && types[0] != channel.Type {
		return 0, false, fmt.Errorf("native scheduler channel for legacy account %d has type %d, expected %d", channel.SourceAccountID, types[0], channel.Type)
	}

	var modelMapping any
	if len(channel.ModelMapping) != 0 {
		encoded, marshalErr := common.Marshal(channel.ModelMapping)
		if marshalErr != nil {
			return 0, false, fmt.Errorf("encode model mapping for legacy account %d: %w", channel.SourceAccountID, marshalErr)
		}
		modelMapping = string(encoded)
	}
	setting, err := common.Marshal(channel.Setting)
	if err != nil {
		return 0, false, fmt.Errorf("encode channel setting for legacy account %d: %w", channel.SourceAccountID, err)
	}
	baseURL := any(nil)
	if strings.TrimSpace(channel.BaseURL) != "" {
		baseURL = channel.BaseURL
	}
	group := strings.Join(channel.Groups, ",")
	models := strings.Join(channel.Models, ",")
	weight := int64(channel.Weight)
	createdTime := time.Now().Unix()

	if len(ids) == 1 {
		_, err := tx.ExecContext(ctx, `
			UPDATE channels
			SET type = $1, key = $2, status = $3, name = $4, weight = $5,
				base_url = $6, models = $7, "group" = $8, model_mapping = $9,
				priority = $10, tag = $11, setting = $12
			WHERE id = $13
		`,
			channel.Type, key, channel.Status, channel.Name, weight, baseURL,
			models, group, modelMapping, channel.Priority, tag, string(setting), ids[0],
		)
		if err != nil {
			return 0, false, fmt.Errorf("update native scheduler channel for legacy account %d: %w", channel.SourceAccountID, err)
		}
		return ids[0], false, nil
	}

	var id int
	err = tx.QueryRowContext(ctx, `
		INSERT INTO channels (
			type, key, status, name, weight, created_time, test_time,
			response_time, base_url, other, balance, balance_updated_time,
			models, "group", used_quota, model_mapping, status_code_mapping,
			priority, auto_ban, other_info, tag, setting, param_override,
			header_override, channel_info, settings
		)
		VALUES (
			$1, $2, $3, $4, $5, $6, 0,
			0, $7, '', 0, 0,
			$8, $9, 0, $10, NULL,
			$11, 0, '', $12, $13, NULL,
			NULL, '{}'::json, ''
		)
		RETURNING id
	`,
		channel.Type, key, channel.Status, channel.Name, weight, createdTime, baseURL,
		models, group, modelMapping, channel.Priority, tag, string(setting),
	).Scan(&id)
	if err != nil {
		return 0, false, fmt.Errorf("insert native scheduler channel for legacy account %d: %w", channel.SourceAccountID, err)
	}
	return id, true, nil
}

func replaceNativeSchedulerAbilities(ctx context.Context, tx *sql.Tx, channel nativeChannelPlan, channelID int) (int, error) {
	if channelID <= 0 {
		return 0, errors.New("native scheduler channel has invalid target id")
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM abilities WHERE channel_id = $1`, channelID); err != nil {
		return 0, fmt.Errorf("delete native scheduler abilities for channel %d: %w", channelID, err)
	}
	tag := nativeSchedulerChannelTag(channel.SourceAccountID)
	count := 0
	for _, group := range channel.Groups {
		for _, model := range channel.Models {
			_, err := tx.ExecContext(ctx, `
				INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
			`, group, model, channelID, channel.Status == common.ChannelStatusEnabled, channel.Priority, channel.Weight, tag)
			if err != nil {
				return count, fmt.Errorf("insert native scheduler ability for channel %d: %w", channelID, err)
			}
			count++
		}
	}
	return count, nil
}

func nativeSchedulerChannelTag(accountID int64) string {
	return nativeSchedulerTagPrefix + strconv.FormatInt(accountID, 10)
}
