package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
)

const geminiImageURLBridgeHeader = "X-Zaoyoe-Gemini-Image-Url-Bridge"

type geminiImageURLBridgeResult struct {
	usage *ClaudeUsage
}

type geminiImageURLBridgeStorageConfig struct {
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	PublicURL       string
	Region          string
}

type geminiImageURLBridgeItem struct {
	Data          string
	MimeType      string
	RevisedPrompt string
}

func (s *GeminiMessagesCompatService) shouldBridgeGeminiImageURL(c *gin.Context, model string, action string) bool {
	if c == nil || !isImageGenerationModel(model) {
		return false
	}
	if action != "generateContent" && action != "streamGenerateContent" {
		return false
	}
	value := strings.TrimSpace(c.GetHeader(geminiImageURLBridgeHeader))
	return value == "1" || strings.EqualFold(value, "true") || strings.EqualFold(value, "url")
}

func (s *GeminiMessagesCompatService) handleGeminiImageURLBridgeResponse(ctx context.Context, c *gin.Context, resp *http.Response, originalModel string, mappedModel string, isOAuth bool) (*geminiImageURLBridgeResult, error) {
	collected, usage, err := collectGeminiSSE(resp.Body, isOAuth)
	if err != nil {
		return nil, s.writeGoogleError(c, http.StatusBadGateway, "Failed to read upstream image stream")
	}
	result, err := s.writeGeminiImageURLBridgePayload(ctx, c, collected, originalModel, mappedModel)
	if err != nil {
		return nil, err
	}
	if result.usage == nil {
		result.usage = usage
	}
	return result, nil
}

func (s *GeminiMessagesCompatService) writeGeminiImageURLBridgePayload(ctx context.Context, c *gin.Context, payload map[string]any, originalModel string, mappedModel string) (*geminiImageURLBridgeResult, error) {
	items := extractGeminiImageURLBridgeItems(payload)
	if len(items) == 0 {
		return s.writeGeminiImageURLBridgeFallbackPayload(c, payload, "no_inline_image_data"), nil
	}
	storage, ok := readGeminiImageURLBridgeStorageConfig()
	if !ok {
		return nil, s.writeGoogleError(c, http.StatusServiceUnavailable, "Gemini image URL bridge storage is not configured")
	}
	urls, err := uploadGeminiImageURLBridgeItems(ctx, storage, items, mappedModel)
	if err != nil {
		return s.writeGeminiImageURLBridgeFallbackPayload(c, payload, "store_failed"), nil
	}

	data := make([]map[string]any, 0, len(urls))
	for i, url := range urls {
		data = append(data, map[string]any{
			"url":            url,
			"image_url":      url,
			"mime_type":      items[i].MimeType,
			"revised_prompt": items[i].RevisedPrompt,
		})
	}
	response := map[string]any{
		"object":   "gemini.image_url_bridge",
		"model":    originalModel,
		"upstream": mappedModel,
		"data":     data,
	}
	if usage := extractGeminiUsage(mustJSONMarshal(payload)); usage != nil {
		response["usage"] = usage
	}
	c.JSON(http.StatusOK, response)
	return &geminiImageURLBridgeResult{usage: extractGeminiUsage(mustJSONMarshal(payload))}, nil
}

func (s *GeminiMessagesCompatService) writeGeminiImageURLBridgeFallbackPayload(c *gin.Context, payload map[string]any, reason string) *geminiImageURLBridgeResult {
	response := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		response[key] = value
	}
	response["zaoyoe_image_url_bridge"] = map[string]any{
		"fallback_used": true,
		"reason":        reason,
	}
	c.Header("X-Zaoyoe-Gemini-Image-Url-Bridge", "fallback")
	c.JSON(http.StatusOK, response)
	return &geminiImageURLBridgeResult{usage: extractGeminiUsage(mustJSONMarshal(payload))}
}

func readGeminiImageURLBridgeStorageConfig() (geminiImageURLBridgeStorageConfig, bool) {
	cfg := geminiImageURLBridgeStorageConfig{
		Endpoint:        firstNonEmptyEnv("GEMINI_IMAGE_BRIDGE_R2_ENDPOINT", "AI_IMAGE_R2_ENDPOINT", "R2_ENDPOINT"),
		AccessKeyID:     firstNonEmptyEnv("GEMINI_IMAGE_BRIDGE_R2_ACCESS_KEY_ID", "AI_IMAGE_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID", "R2_ACCESS_KEY"),
		SecretAccessKey: firstNonEmptyEnv("GEMINI_IMAGE_BRIDGE_R2_SECRET_ACCESS_KEY", "AI_IMAGE_R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY", "R2_SECRET_KEY"),
		Bucket:          firstNonEmptyEnv("GEMINI_IMAGE_BRIDGE_R2_BUCKET_NAME", "AI_IMAGE_R2_BUCKET_NAME", "R2_BUCKET_NAME"),
		PublicURL:       strings.TrimRight(firstNonEmptyEnv("GEMINI_IMAGE_BRIDGE_R2_PUBLIC_URL", "AI_IMAGE_R2_PUBLIC_URL", "R2_PUBLIC_URL"), "/"),
		Region:          firstNonEmptyEnv("GEMINI_IMAGE_BRIDGE_R2_REGION", "AI_IMAGE_R2_REGION", "R2_REGION"),
	}
	if cfg.Bucket == "" {
		cfg.Bucket = "zaoyoeimages"
	}
	if cfg.PublicURL == "" {
		cfg.PublicURL = "https://cdn.fatherkey.com"
	}
	if cfg.Region == "" {
		cfg.Region = "auto"
	}
	return cfg, cfg.Endpoint != "" && cfg.AccessKeyID != "" && cfg.SecretAccessKey != "" && cfg.Bucket != "" && cfg.PublicURL != ""
}

func firstNonEmptyEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func extractGeminiImageURLBridgeItems(payload map[string]any) []geminiImageURLBridgeItem {
	parts := extractGeminiParts(payload)
	items := make([]geminiImageURLBridgeItem, 0, len(parts))
	revisedPrompt := ""
	for _, part := range parts {
		if text, ok := part["text"].(string); ok && strings.TrimSpace(text) != "" && revisedPrompt == "" {
			revisedPrompt = strings.TrimSpace(text)
		}
		inline, ok := part["inlineData"].(map[string]any)
		if !ok {
			inline, ok = part["inline_data"].(map[string]any)
		}
		if !ok || inline == nil {
			continue
		}
		data, _ := inline["data"].(string)
		mimeType, _ := inline["mimeType"].(string)
		if mimeType == "" {
			mimeType, _ = inline["mime_type"].(string)
		}
		data = strings.TrimSpace(data)
		if data == "" {
			continue
		}
		if strings.TrimSpace(mimeType) == "" {
			mimeType = "image/png"
		}
		items = append(items, geminiImageURLBridgeItem{
			Data:          data,
			MimeType:      strings.TrimSpace(mimeType),
			RevisedPrompt: revisedPrompt,
		})
	}
	return items
}

func uploadGeminiImageURLBridgeItems(ctx context.Context, cfg geminiImageURLBridgeStorageConfig, items []geminiImageURLBridgeItem, model string) ([]string, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(cfg.AccessKeyID, cfg.SecretAccessKey, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		if cfg.Endpoint != "" {
			o.BaseEndpoint = &cfg.Endpoint
		}
		o.APIOptions = append(o.APIOptions, v4.SwapComputePayloadSHA256ForUnsignedPayloadMiddleware)
		o.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
	})

	urls := make([]string, 0, len(items))
	for index, item := range items {
		raw, err := base64.StdEncoding.DecodeString(item.Data)
		if err != nil {
			return nil, fmt.Errorf("decode inline image: %w", err)
		}
		if len(raw) == 0 {
			return nil, errors.New("empty inline image")
		}
		key := buildGeminiImageURLBridgeKey(raw, item.MimeType, model, index)
		_, err = client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:       &cfg.Bucket,
			Key:          &key,
			Body:         bytes.NewReader(raw),
			ContentType:  &item.MimeType,
			CacheControl: aws.String("public, max-age=31536000, immutable"),
		})
		if err != nil {
			return nil, fmt.Errorf("put image object: %w", err)
		}
		urls = append(urls, cfg.PublicURL+"/"+key)
	}
	return urls, nil
}

func buildGeminiImageURLBridgeKey(raw []byte, mimeType string, model string, index int) string {
	ext := "png"
	switch {
	case strings.Contains(strings.ToLower(mimeType), "webp"):
		ext = "webp"
	case strings.Contains(strings.ToLower(mimeType), "jpeg"), strings.Contains(strings.ToLower(mimeType), "jpg"):
		ext = "jpg"
	}
	sum := sha256.Sum256(raw)
	digest := hex.EncodeToString(sum[:])[:16]
	now := time.Now().UTC()
	safeModel := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '-' || r == '_':
			return r
		default:
			return '-'
		}
	}, strings.TrimSpace(model))
	if safeModel == "" {
		safeModel = "gemini-image"
	}
	return fmt.Sprintf("ai-images/gemini-bridge/%04d/%02d/%s/%d-%s.%s", now.Year(), now.Month(), safeModel, index, digest, ext)
}

func mustJSONMarshal(value any) []byte {
	data, _ := json.Marshal(value)
	return data
}
