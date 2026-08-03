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
	defaultBridgeBaseURL = "http://legacy-sub2api:8080"
	defaultMigrationMark = "sub2api-to-newapi-v1"
)

func main() {
	if err := run(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "sub2api migration failed: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
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
	if completed {
		expectedBridgeGroups, err := countMigratableLegacyGroups(ctx, source)
		if err != nil {
			return err
		}
		needsRepair, err := bridgeChannelsNeedRepair(ctx, target, expectedBridgeGroups)
		if err != nil {
			return err
		}
		if !needsRepair {
			fmt.Printf("Sub2API migration %s already completed; no data was changed.\n", migrationMark)
			return nil
		}

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
		} else {
			fmt.Printf("Sub2API migration %s already completed; no data was changed.\n", migrationMark)
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

	fmt.Printf(
		"Sub2API migration %s completed: %d users, %d API keys, %d bridge groups.\n",
		migrationMark,
		len(data.Users),
		len(data.Tokens),
		len(data.Groups),
	)
	return nil
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
