package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	defaultBridgeBaseURL     = "http://legacy-sub2api:8080"
	defaultMigrationMark     = "sub2api-to-newapi-v1"
	groupOptionsRepairEnv    = "GROUP_OPTIONS_REPAIR_ONLY"
	preservePartialBridgeEnv = "PRESERVE_PARTIAL_BRIDGE_STATE"
)

func main() {
	if err := run(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "sub2api migration failed: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	if isNativeSchedulerShadowCompare(os.Getenv("SHADOW_COMPARE")) {
		if isNativeSchedulerPlanOnly(os.Getenv("PLAN_ONLY")) || isNativeSchedulerImport(os.Getenv(nativeSchedulerImportEnv)) || isGroupOptionsRepairOnly(os.Getenv(groupOptionsRepairEnv)) {
			return fmt.Errorf("SHADOW_COMPARE cannot be enabled together with PLAN_ONLY, %s, or %s", nativeSchedulerImportEnv, groupOptionsRepairEnv)
		}
		return runNativeSchedulerShadowCompare(ctx)
	}
	if isNativeSchedulerPlanOnly(os.Getenv("PLAN_ONLY")) {
		if isNativeSchedulerImport(os.Getenv(nativeSchedulerImportEnv)) || isGroupOptionsRepairOnly(os.Getenv(groupOptionsRepairEnv)) {
			return fmt.Errorf("PLAN_ONLY cannot be enabled together with %s or %s", nativeSchedulerImportEnv, groupOptionsRepairEnv)
		}
		return runNativeSchedulerPlan(ctx)
	}
	if isNativeSchedulerImport(os.Getenv(nativeSchedulerImportEnv)) {
		if isGroupOptionsRepairOnly(os.Getenv(groupOptionsRepairEnv)) {
			return fmt.Errorf("%s cannot be enabled together with %s", nativeSchedulerImportEnv, groupOptionsRepairEnv)
		}
		return runNativeSchedulerImport(ctx)
	}
	if isGroupOptionsRepairOnly(os.Getenv(groupOptionsRepairEnv)) {
		return runGroupOptionsRepair(ctx)
	}
	sourceDSN, err := requiredEnv("SOURCE_SQL_DSN")
	if err != nil {
		return err
	}
	targetDSN, err := requiredEnv("TARGET_SQL_DSN")
	if err != nil {
		return err
	}
	sourceBaseURL, err := requiredEnv("SOURCE_BASE_URL")
	if err != nil {
		return err
	}
	bridgeBaseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("BRIDGE_BASE_URL")), "/")
	if bridgeBaseURL == "" {
		bridgeBaseURL = defaultBridgeBaseURL
	}
	migrationMark := strings.TrimSpace(os.Getenv("MIGRATION_VERSION"))
	if migrationMark == "" {
		migrationMark = defaultMigrationMark
	}

	source, err := openDatabase(ctx, sourceDSN)
	if err != nil {
		return fmt.Errorf("open source database: %w", err)
	}
	defer source.Close()
	target, err := openDatabase(ctx, targetDSN)
	if err != nil {
		return fmt.Errorf("open target database: %w", err)
	}
	defer target.Close()

	completed, err := migrationCompleted(ctx, target, migrationMark)
	if err != nil {
		return err
	}
	preservePartialBridge := isPreservePartialBridgeState(os.Getenv(preservePartialBridgeEnv))
	if preservePartialBridge && !completed {
		return fmt.Errorf("%s requires an existing completed migration", preservePartialBridgeEnv)
	}
	if completed {
		smtpRepaired, err := repairMissingSMTPSettings(ctx, source, target)
		if err != nil {
			return err
		}
		legalRepaired, err := repairMissingLegalSettings(ctx, source, target)
		if err != nil {
			return err
		}
		groupOptionsRepaired, err := repairMissingGroupOptions(ctx, source, target)
		if err != nil {
			return err
		}
		needsRepair := false
		if !preservePartialBridge {
			expectedBridgeGroups, countErr := countMigratableLegacyGroups(ctx, source)
			if countErr != nil {
				return countErr
			}
			needsRepair, err = bridgeChannelsNeedRepair(ctx, target, expectedBridgeGroups)
			if err != nil {
				return err
			}
		} else {
			fmt.Printf("Sub2API migration %s preserving existing partial bridge state by explicit %s=true.\n", migrationMark, preservePartialBridgeEnv)
		}
		if !needsRepair && !smtpRepaired && !legalRepaired && !groupOptionsRepaired {
			fmt.Printf("Sub2API migration %s already completed; no data was changed.\n", migrationMark)
			return nil
		}

		if needsRepair {
			groups, err := loadBridgeGroups(ctx, source, strings.TrimRight(sourceBaseURL, "/"), bridgeBaseURL)
			if err != nil {
				return err
			}
			repaired, err := repairMissingBridgeChannels(ctx, target, groups, migrationMark)
			if err != nil {
				return err
			}
			if repaired {
				fmt.Printf("Sub2API migration %s repaired: %d bridge groups restored.\n", migrationMark, len(groups))
			}
		}
		if smtpRepaired {
			fmt.Printf("Sub2API migration %s repaired: legacy SMTP settings copied to NewAPI.\n", migrationMark)
		}
		if legalRepaired {
			fmt.Printf("Sub2API migration %s repaired: legacy legal settings copied to NewAPI.\n", migrationMark)
		}
		if groupOptionsRepaired {
			fmt.Printf("Sub2API migration %s repaired: active legacy group access options restored to NewAPI.\n", migrationMark)
		}
		return nil
	}

	if err := requireEmptyTarget(ctx, target); err != nil {
		return err
	}
	if err := auditSource(ctx, source); err != nil {
		return err
	}

	data, err := loadMigrationData(ctx, source, strings.TrimRight(sourceBaseURL, "/"), bridgeBaseURL)
	if err != nil {
		return err
	}
	if err := migrateTarget(ctx, target, data, migrationMark); err != nil {
		return err
	}
	if _, err := repairMissingSMTPSettings(ctx, source, target); err != nil {
		return err
	}
	if _, err := repairMissingLegalSettings(ctx, source, target); err != nil {
		return err
	}
	if _, err := repairMissingGroupOptions(ctx, source, target); err != nil {
		return err
	}

	fmt.Printf(
		"Sub2API migration %s completed: %d users, %d API keys, %d bridge groups.\n",
		migrationMark,
		len(data.Users),
		len(data.Tokens),
		len(data.Groups),
	)
	return nil
}

func runGroupOptionsRepair(ctx context.Context) error {
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
		return fmt.Errorf("open source database: %w", err)
	}
	defer source.Close()
	target, err := openDatabase(ctx, targetDSN)
	if err != nil {
		return fmt.Errorf("open target database: %w", err)
	}
	defer target.Close()
	repaired, err := repairMissingGroupOptions(ctx, source, target)
	if err != nil {
		return err
	}
	if repaired {
		fmt.Println("NewAPI group access options repaired atomically.")
	} else {
		fmt.Println("NewAPI group access options already contain all active legacy groups; no data was changed.")
	}
	return nil
}

func isNativeSchedulerShadowCompare(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func isNativeSchedulerPlanOnly(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func isGroupOptionsRepairOnly(value string) bool {
	return isNativeSchedulerPlanOnly(value)
}

func isPreservePartialBridgeState(value string) bool {
	return isNativeSchedulerPlanOnly(value)
}

func requiredEnv(key string) (string, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return "", fmt.Errorf("%s is required", key)
	}
	return value, nil
}

func openDatabase(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}
