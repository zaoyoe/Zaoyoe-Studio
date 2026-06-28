package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/util/responseheaders"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

const openAIVideosGenerationsEndpoint = "/v1/videos/generations"
const openAIVideosGenerationsFallbackEndpoint = "/v1/images/generations"

type OpenAIVideosRequest struct {
	Model  string
	Prompt string
}

func (s *OpenAIGatewayService) ParseOpenAIVideosRequest(body []byte) (*OpenAIVideosRequest, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("request body is empty")
	}
	if !gjson.ValidBytes(body) {
		return nil, fmt.Errorf("failed to parse request body")
	}
	model := strings.TrimSpace(gjson.GetBytes(body, "model").String())
	if model == "" {
		return nil, fmt.Errorf("model is required")
	}
	return &OpenAIVideosRequest{
		Model:  model,
		Prompt: strings.TrimSpace(gjson.GetBytes(body, "prompt").String()),
	}, nil
}

func (r *OpenAIVideosRequest) ModerationBody() []byte {
	if r == nil {
		return nil
	}
	return []byte(fmt.Sprintf(`{"prompt":%q}`, r.Prompt))
}

func (s *OpenAIGatewayService) ForwardVideos(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	body []byte,
	parsed *OpenAIVideosRequest,
	defaultMappedModel string,
) (*OpenAIForwardResult, error) {
	startTime := time.Now()
	if parsed == nil {
		return nil, fmt.Errorf("video request is nil")
	}
	requestModel := strings.TrimSpace(parsed.Model)
	if requestModel == "" {
		writeOpenAIVideosError(c, http.StatusBadRequest, "invalid_request_error", "model is required")
		return nil, fmt.Errorf("missing model in request")
	}
	if account == nil {
		return nil, fmt.Errorf("account is nil")
	}
	if account.Type != AccountTypeAPIKey {
		return nil, fmt.Errorf("videos endpoint requires an OpenAI-compatible API key account")
	}

	billingModel := resolveOpenAIForwardModel(account, requestModel, defaultMappedModel)
	upstreamModel := normalizeOpenAIModelForUpstream(account, billingModel)
	upstreamBody := body
	if upstreamModel != requestModel {
		upstreamBody = ReplaceModelInBody(body, upstreamModel)
	}

	logger.L().Debug("openai videos: forwarding",
		zap.Int64("account_id", account.ID),
		zap.String("request_model", requestModel),
		zap.String("billing_model", billingModel),
		zap.String("upstream_model", upstreamModel),
	)

	apiKey := account.GetOpenAIApiKey()
	if apiKey == "" {
		return nil, fmt.Errorf("account %d missing api_key", account.ID)
	}
	baseURL := account.GetOpenAIBaseURL()
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	validatedURL, err := s.validateUpstreamBaseURL(baseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base_url: %w", err)
	}
	targetURLs := buildOpenAIVideosCandidateURLs(validatedURL, account)

	upstreamCtx, releaseUpstreamCtx := detachUpstreamContext(ctx)
	upstreamReq, err := buildOpenAIVideosUpstreamRequest(upstreamCtx, c, account, targetURLs[0], apiKey, upstreamBody)
	releaseUpstreamCtx()
	if err != nil {
		return nil, fmt.Errorf("build upstream request: %w", err)
	}

	proxyURL := ""
	if account.Proxy != nil {
		proxyURL = account.Proxy.URL()
	}
	upstreamStart := time.Now()
	resp, err := s.httpUpstream.Do(upstreamReq, proxyURL, account.ID, account.Concurrency)
	firstUpstreamLatencyMs := time.Since(upstreamStart).Milliseconds()
	SetOpsLatencyMs(c, OpsUpstreamLatencyMsKey, firstUpstreamLatencyMs)
	if err != nil {
		safeErr := sanitizeUpstreamErrorMessage(err.Error())
		setOpsUpstreamError(c, 0, safeErr, "")
		appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
			Platform:           account.Platform,
			AccountID:          account.ID,
			AccountName:        account.Name,
			UpstreamStatusCode: 0,
			UpstreamURL:        safeUpstreamURL(upstreamReq.URL.String()),
			Kind:               "request_error",
			Message:            safeErr,
		})
		writeOpenAIVideosError(c, http.StatusBadGateway, "upstream_error", "Upstream request failed")
		return nil, fmt.Errorf("upstream request failed: %s", safeErr)
	}
	if resp.StatusCode >= 400 {
		respBody := s.readUpstreamErrorBody(resp)
		_ = resp.Body.Close()
		resp.Body = io.NopCloser(bytes.NewReader(respBody))

		upstreamMsg := strings.TrimSpace(extractUpstreamErrorMessage(respBody))
		upstreamMsg = sanitizeUpstreamErrorMessage(upstreamMsg)
		if shouldFallbackOpenAIVideosEndpoint(resp.StatusCode, upstreamMsg) && len(targetURLs) > 1 {
			appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
				Platform:           account.Platform,
				AccountID:          account.ID,
				AccountName:        account.Name,
				UpstreamStatusCode: resp.StatusCode,
				UpstreamRequestID:  resp.Header.Get("x-request-id"),
				UpstreamURL:        safeUpstreamURL(upstreamReq.URL.String()),
				Kind:               "endpoint_fallback",
				Message:            upstreamMsg,
			})

			fallbackCtx, releaseFallbackCtx := detachUpstreamContext(ctx)
			fallbackReq, fallbackErr := buildOpenAIVideosUpstreamRequest(fallbackCtx, c, account, targetURLs[1], apiKey, upstreamBody)
			releaseFallbackCtx()
			if fallbackErr != nil {
				return nil, fmt.Errorf("build fallback upstream request: %w", fallbackErr)
			}
			fallbackStart := time.Now()
			resp, err = s.httpUpstream.Do(fallbackReq, proxyURL, account.ID, account.Concurrency)
			SetOpsLatencyMs(c, OpsUpstreamLatencyMsKey, firstUpstreamLatencyMs+time.Since(fallbackStart).Milliseconds())
			if err != nil {
				safeErr := sanitizeUpstreamErrorMessage(err.Error())
				setOpsUpstreamError(c, 0, safeErr, "")
				appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
					Platform:           account.Platform,
					AccountID:          account.ID,
					AccountName:        account.Name,
					UpstreamStatusCode: 0,
					UpstreamURL:        safeUpstreamURL(fallbackReq.URL.String()),
					Kind:               "request_error",
					Message:            safeErr,
				})
				writeOpenAIVideosError(c, http.StatusBadGateway, "upstream_error", "Upstream request failed")
				return nil, fmt.Errorf("fallback upstream request failed: %s", safeErr)
			}
			defer func() { _ = resp.Body.Close() }()
			upstreamReq = fallbackReq
			if resp.StatusCode >= 400 {
				respBody = s.readUpstreamErrorBody(resp)
				_ = resp.Body.Close()
				resp.Body = io.NopCloser(bytes.NewReader(respBody))
				upstreamMsg = strings.TrimSpace(extractUpstreamErrorMessage(respBody))
				upstreamMsg = sanitizeUpstreamErrorMessage(upstreamMsg)
			} else {
				respBody, err := ReadUpstreamResponseBody(resp.Body, s.cfg, c, openAITooLargeError)
				_ = resp.Body.Close()
				if err != nil {
					if !errors.Is(err, ErrUpstreamResponseBodyTooLarge) {
						writeOpenAIVideosError(c, http.StatusBadGateway, "api_error", "Failed to read upstream response")
					}
					return nil, fmt.Errorf("read fallback upstream body: %w", err)
				}

				writeOpenAIVideosUpstreamResponse(c, resp, respBody, s.responseHeaderFilter)

				usage, _ := extractOpenAIUsageFromJSONBytes(respBody)
				return &OpenAIForwardResult{
					RequestID:       firstNonEmptyString(resp.Header.Get("x-request-id"), resp.Header.Get("request-id")),
					Usage:           usage,
					Model:           requestModel,
					BillingModel:    billingModel,
					UpstreamModel:   upstreamModel,
					Stream:          false,
					ResponseHeaders: resp.Header.Clone(),
					Duration:        time.Since(startTime),
				}, nil
			}
		}
		if s.shouldFailoverOpenAIUpstreamResponse(resp.StatusCode, upstreamMsg, respBody) {
			appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
				Platform:           account.Platform,
				AccountID:          account.ID,
				AccountName:        account.Name,
				UpstreamStatusCode: resp.StatusCode,
				UpstreamRequestID:  resp.Header.Get("x-request-id"),
				UpstreamURL:        safeUpstreamURL(upstreamReq.URL.String()),
				Kind:               "failover",
				Message:            upstreamMsg,
			})
			s.handleFailoverSideEffects(ctx, resp, account, respBody, upstreamModel)
			return nil, &UpstreamFailoverError{
				StatusCode:             resp.StatusCode,
				ResponseBody:           respBody,
				RetryableOnSameAccount: account.IsPoolMode() && account.IsPoolModeRetryableStatus(resp.StatusCode),
			}
		}
		writeOpenAIVideosUpstreamResponse(c, resp, respBody, s.responseHeaderFilter)
		return nil, fmt.Errorf("upstream returned status %d", resp.StatusCode)
	}

	respBody, err := ReadUpstreamResponseBody(resp.Body, s.cfg, c, openAITooLargeError)
	_ = resp.Body.Close()
	if err != nil {
		if !errors.Is(err, ErrUpstreamResponseBodyTooLarge) {
			writeOpenAIVideosError(c, http.StatusBadGateway, "api_error", "Failed to read upstream response")
		}
		return nil, fmt.Errorf("read upstream body: %w", err)
	}

	writeOpenAIVideosUpstreamResponse(c, resp, respBody, s.responseHeaderFilter)

	usage, _ := extractOpenAIUsageFromJSONBytes(respBody)
	return &OpenAIForwardResult{
		RequestID:       firstNonEmptyString(resp.Header.Get("x-request-id"), resp.Header.Get("request-id")),
		Usage:           usage,
		Model:           requestModel,
		BillingModel:    billingModel,
		UpstreamModel:   upstreamModel,
		Stream:          false,
		ResponseHeaders: resp.Header.Clone(),
		Duration:        time.Since(startTime),
	}, nil
}

func buildOpenAIVideosURL(base string) string {
	return buildOpenAIEndpointURL(base, openAIVideosGenerationsEndpoint)
}

func buildOpenAIVideosCandidateURLs(base string, account *Account) []string {
	endpoint := openAIVideosGenerationsEndpoint
	if account != nil {
		endpoint = strings.TrimSpace(firstNonEmptyString(
			account.GetCredential("video_endpoint"),
			account.GetCredential("video_generation_endpoint"),
		))
		if endpoint == "" {
			endpoint = openAIVideosGenerationsEndpoint
		}
	}
	targets := []string{buildOpenAIVideosTargetURL(base, endpoint)}
	fallback := buildOpenAIEndpointURL(base, openAIVideosGenerationsFallbackEndpoint)
	if targets[0] != fallback {
		targets = append(targets, fallback)
	}
	return targets
}

func buildOpenAIVideosTargetURL(base string, endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if strings.HasPrefix(strings.ToLower(endpoint), "http://") || strings.HasPrefix(strings.ToLower(endpoint), "https://") {
		return endpoint
	}
	return buildOpenAIEndpointURL(base, endpoint)
}

func buildOpenAIVideosUpstreamRequest(ctx context.Context, c *gin.Context, account *Account, targetURL string, apiKey string, body []byte) (*http.Request, error) {
	upstreamReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	upstreamReq = upstreamReq.WithContext(WithHTTPUpstreamProfile(upstreamReq.Context(), HTTPUpstreamProfileOpenAI))
	upstreamReq.Header.Set("Content-Type", "application/json")
	upstreamReq.Header.Set("Authorization", "Bearer "+apiKey)
	upstreamReq.Header.Set("Accept", "application/json")
	if c != nil && c.Request != nil {
		for key, values := range c.Request.Header {
			lowerKey := strings.ToLower(key)
			if openaiCCRawAllowedHeaders[lowerKey] {
				for _, v := range values {
					upstreamReq.Header.Add(key, v)
				}
			}
		}
	}
	if account != nil {
		if customUA := account.GetOpenAIUserAgent(); customUA != "" {
			upstreamReq.Header.Set("User-Agent", customUA)
		}
	}
	return upstreamReq, nil
}

func shouldFallbackOpenAIVideosEndpoint(statusCode int, upstreamMsg string) bool {
	if statusCode != http.StatusNotFound {
		return false
	}
	msg := strings.ToLower(strings.TrimSpace(upstreamMsg))
	return msg == "" ||
		strings.Contains(msg, "invalid url") ||
		strings.Contains(msg, "404 page not found") ||
		strings.Contains(msg, "page not found") ||
		strings.Contains(msg, "route not found") ||
		strings.Contains(msg, "no route") ||
		strings.Contains(msg, "cannot post")
}

func writeOpenAIVideosUpstreamResponse(c *gin.Context, resp *http.Response, body []byte, filter *responseheaders.CompiledHeaderFilter) {
	if c == nil || resp == nil || c.Writer.Written() {
		return
	}
	if resp.Header != nil {
		responseheaders.WriteFilteredHeaders(c.Writer.Header(), resp.Header, filter)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		c.Writer.Header().Set("Content-Type", ct)
	} else {
		c.Writer.Header().Set("Content-Type", "application/json")
	}
	c.Writer.WriteHeader(resp.StatusCode)
	_, _ = c.Writer.Write(body)
}

func writeOpenAIVideosError(c *gin.Context, statusCode int, errType, message string) {
	c.JSON(statusCode, gin.H{
		"error": gin.H{
			"type":    errType,
			"message": message,
		},
	})
}
