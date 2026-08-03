package main

import (
	"log"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load(".env")
	common.InitEnv()
	logger.SetupLogger()

	if err := model.InitDB(); err != nil {
		log.Fatalf("migrate NewAPI database: %v", err)
	}
	defer func() {
		if err := model.CloseDB(); err != nil {
			log.Printf("close NewAPI database: %v", err)
		}
	}()

	if common.IsMasterNode {
		if err := model.MigrateRetiredFrontendOptions(); err != nil {
			log.Fatalf("migrate retired frontend options: %v", err)
		}
	}
}
