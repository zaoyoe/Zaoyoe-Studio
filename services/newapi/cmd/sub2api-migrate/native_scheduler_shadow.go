package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// nativeSchedulerShadowQuery deliberately omits channels.key. Shadow
// comparison is safe to run in logs or CI output and must never expose an
// upstream credential.
const nativeSchedulerShadowQuery = `
	SELECT
		id,
		type,
		name,
		status,
		COALESCE(weight, 0),
		COALESCE(base_url, ''),
		COALESCE(models, ''),
		COALESCE("group", ''),
		COALESCE(model_mapping, ''),
		COALESCE(priority, 0),
		tag
	FROM channels
	WHERE tag LIKE $1
	ORDER BY tag, id
`

type nativeSchedulerShadowChannel struct {
	ID           int
	Type         int
	Name         string
	Status       int
	Weight       uint
	BaseURL      string
	Models       string
	Group        string
	ModelMapping string
	Priority     int64
	Tag          string
}

type nativeSchedulerShadowIssue struct {
	Tag       string `json:"tag"`
	AccountID int64  `json:"account_id,omitempty"`
	Field     string `json:"field"`
	Expected  string `json:"expected,omitempty"`
	Actual    string `json:"actual,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type nativeSchedulerShadowReport struct {
	Version     string                       `json:"version"`
	ComparedAt  time.Time                    `json:"compared_at"`
	Planned     int                          `json:"planned"`
	Matched     int                          `json:"matched"`
	Missing     int                          `json:"missing"`
	Mismatched  int                          `json:"mismatched"`
	Unexpected  int                          `json:"unexpected"`
	Unsupported []nativePlanIssue            `json:"unsupported,omitempty"`
	Issues      []nativeSchedulerShadowIssue `json:"issues,omitempty"`
}

func runNativeSchedulerShadowCompare(ctx context.Context) error {
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
		return fmt.Errorf("open source database for native scheduler shadow comparison: %w", err)
	}
	defer source.Close()
	target, err := openDatabase(ctx, targetDSN)
	if err != nil {
		return fmt.Errorf("open target database for native scheduler shadow comparison: %w", err)
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
	channels, err := loadNativeSchedulerShadowChannels(ctx, target)
	if err != nil {
		return err
	}
	report := compareNativeSchedulerShadow(plan, channels, time.Now().UTC())
	raw, err := common.Marshal(report)
	if err != nil {
		return fmt.Errorf("encode native scheduler shadow comparison: %w", err)
	}
	fmt.Println(string(raw))
	if report.Missing != 0 || report.Mismatched != 0 || report.Unexpected != 0 || len(report.Unsupported) != 0 {
		return fmt.Errorf("native scheduler shadow comparison found missing=%d mismatched=%d unexpected=%d unsupported=%d", report.Missing, report.Mismatched, report.Unexpected, len(report.Unsupported))
	}
	return nil
}

func loadNativeSchedulerShadowChannels(ctx context.Context, target *sql.DB) ([]nativeSchedulerShadowChannel, error) {
	rows, err := target.QueryContext(ctx, nativeSchedulerShadowQuery, nativeSchedulerTagPrefix+"%")
	if err != nil {
		return nil, fmt.Errorf("query native scheduler channels: %w", err)
	}
	defer rows.Close()
	channels := make([]nativeSchedulerShadowChannel, 0)
	for rows.Next() {
		var channel nativeSchedulerShadowChannel
		var weight sql.NullInt64
		if err := rows.Scan(
			&channel.ID, &channel.Type, &channel.Name, &channel.Status, &weight,
			&channel.BaseURL, &channel.Models, &channel.Group, &channel.ModelMapping,
			&channel.Priority, &channel.Tag,
		); err != nil {
			return nil, fmt.Errorf("scan native scheduler channel: %w", err)
		}
		if weight.Valid && weight.Int64 >= 0 {
			channel.Weight = uint(weight.Int64)
		}
		channels = append(channels, channel)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate native scheduler channels: %w", err)
	}
	return channels, nil
}

func compareNativeSchedulerShadow(plan nativeSchedulerPlan, actual []nativeSchedulerShadowChannel, comparedAt time.Time) nativeSchedulerShadowReport {
	report := nativeSchedulerShadowReport{
		Version:     nativeSchedulerPlanVersion,
		ComparedAt:  comparedAt.UTC(),
		Planned:     len(plan.Channels),
		Unsupported: append([]nativePlanIssue(nil), plan.Report.Unsupported...),
	}
	actualByTag := make(map[string]nativeSchedulerShadowChannel, len(actual))
	for _, channel := range actual {
		if _, exists := actualByTag[channel.Tag]; exists {
			report.Issues = append(report.Issues, nativeSchedulerShadowIssue{
				Tag:    channel.Tag,
				Field:  "tag",
				Reason: "duplicate native channel tag",
			})
			report.Mismatched++
			continue
		}
		actualByTag[channel.Tag] = channel
	}
	expectedTags := make(map[string]struct{}, len(plan.Channels))
	for _, expected := range plan.Channels {
		expectedTags[expected.Tag] = struct{}{}
		channel, ok := actualByTag[expected.Tag]
		if !ok {
			report.Missing++
			report.Issues = append(report.Issues, nativeSchedulerShadowIssue{
				Tag:       expected.Tag,
				AccountID: expected.SourceAccountID,
				Field:     "channel",
				Reason:    "native channel is missing",
			})
			continue
		}
		issues := compareNativeSchedulerChannel(expected, channel)
		if len(issues) == 0 {
			report.Matched++
			continue
		}
		report.Mismatched += len(issues)
		report.Issues = append(report.Issues, issues...)
	}
	for _, channel := range actual {
		if _, ok := expectedTags[channel.Tag]; ok {
			continue
		}
		report.Unexpected++
		report.Issues = append(report.Issues, nativeSchedulerShadowIssue{
			Tag:    channel.Tag,
			Field:  "channel",
			Reason: "native channel has no matching legacy account in the selected groups",
		})
	}
	sort.Slice(report.Issues, func(i, j int) bool {
		if report.Issues[i].Tag == report.Issues[j].Tag {
			return report.Issues[i].Field < report.Issues[j].Field
		}
		return report.Issues[i].Tag < report.Issues[j].Tag
	})
	return report
}

func compareNativeSchedulerChannel(expected nativeChannelPlan, actual nativeSchedulerShadowChannel) []nativeSchedulerShadowIssue {
	issues := make([]nativeSchedulerShadowIssue, 0, 8)
	add := func(field, want, got string) {
		if want == got {
			return
		}
		issues = append(issues, nativeSchedulerShadowIssue{
			Tag: expected.Tag, AccountID: expected.SourceAccountID,
			Field: field, Expected: want, Actual: got,
		})
	}
	add("type", strconv.Itoa(expected.Type), strconv.Itoa(actual.Type))
	add("name", expected.Name, actual.Name)
	add("status", strconv.Itoa(expected.Status), strconv.Itoa(actual.Status))
	add("weight", strconv.FormatUint(uint64(expected.Weight), 10), strconv.FormatUint(uint64(actual.Weight), 10))
	add("base_url", expected.BaseURL, actual.BaseURL)
	add("models", strings.Join(expected.Models, ","), actual.Models)
	add("group", strings.Join(expected.Groups, ","), actual.Group)
	add("priority", strconv.FormatInt(expected.Priority, 10), strconv.FormatInt(actual.Priority, 10))
	add("model_mapping", canonicalJSONMap(expected.ModelMapping), canonicalJSONString(actual.ModelMapping))
	add("tag", expected.Tag, actual.Tag)
	return issues
}

func canonicalJSONMap(value map[string]string) string {
	if len(value) == 0 {
		return ""
	}
	raw, err := common.Marshal(value)
	if err != nil {
		return "<invalid>"
	}
	return string(raw)
}

func canonicalJSONString(raw string) string {
	if strings.TrimSpace(raw) == "" || strings.TrimSpace(raw) == "null" {
		return ""
	}
	value, err := stringMapValueFromJSONString(raw)
	if err != nil {
		return "<invalid>"
	}
	return canonicalJSONMap(value)
}

func stringMapValueFromJSONString(raw string) (map[string]string, error) {
	var value map[string]any
	if err := common.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	return stringMapValue(value)
}
