package controller

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	maxSupportMessageRunes       = 4000
	maxSupportPagePathRunes      = 512
	maxSupportPageTitleRunes     = 160
	maxSupportPageSectionRunes   = 80
	maxSupportRequestIDRunes     = 128
	maxSupportClientMessageIDLen = 128
	maxSupportCursorLen          = 256
	maxSupportMessageListLimit   = 50
	defaultSupportMessageLimit   = 50
	maxSupportMessageBodyBytes   = 16 << 10
)

type supportPageInput struct {
	Path      string `json:"path"`
	Title     string `json:"title,omitempty"`
	Section   string `json:"section,omitempty"`
	RequestID string `json:"request_id,omitempty"`
}

type createSupportMessageRequest struct {
	Text            string            `json:"text"`
	Content         string            `json:"content,omitempty"`
	ClientMessageID string            `json:"client_message_id"`
	Page            *supportPageInput `json:"page"`
}

func GetSupportContext(c *gin.Context) {
	principal, ok := requireLiveSupportGatewaySession(c)
	if !ok {
		return
	}
	page, err := supportPageContextFromQuery(c)
	if err != nil {
		writeSupportInputError(c)
		return
	}
	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:    service.SupportGatewayActionContext,
		Principal: principal,
		Page:      &page,
	})
}

func GetSupportMessages(c *gin.Context) {
	principal, ok := requireLiveSupportGatewaySession(c)
	if !ok {
		return
	}
	cursor, limit, err := supportMessageListQuery(c)
	if err != nil {
		writeSupportInputError(c)
		return
	}
	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:    service.SupportGatewayActionMessages,
		Principal: principal,
		Cursor:    cursor,
		Limit:     limit,
	})
}

func CreateSupportMessage(c *gin.Context) {
	principal, ok := requireLiveSupportGatewaySession(c)
	if !ok {
		return
	}
	if c.Request.Body == nil {
		writeSupportInputError(c)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxSupportMessageBodyBytes)

	var input createSupportMessageRequest
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		writeSupportInputError(c)
		return
	}
	text, err := normalizeSupportMessageText(input.Text, input.Content)
	if err != nil {
		writeSupportInputError(c)
		return
	}
	clientMessageID, err := normalizeSupportClientMessageID(input.ClientMessageID)
	if err != nil {
		writeSupportInputError(c)
		return
	}
	page, err := normalizeSupportPageContext(input.Page)
	if err != nil {
		writeSupportInputError(c)
		return
	}

	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:          service.SupportGatewayActionSend,
		Principal:       principal,
		Page:            &page,
		Text:            text,
		ClientMessageID: clientMessageID,
	})
}

func requireLiveSupportGatewaySession(c *gin.Context) (service.SupportGatewayPrincipal, bool) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"code":    "AUTH_SESSION_REQUIRED",
			"message": "a dashboard login session is required",
		})
		return service.SupportGatewayPrincipal{}, false
	}
	_, user, err := service.ValidateLoginSession(identity)
	if err != nil {
		writeAuthSessionError(c, err)
		return service.SupportGatewayPrincipal{}, false
	}
	return service.SupportGatewayPrincipal{
		UserID:   user.Id,
		Username: user.Username,
		Email:    user.Email,
	}, true
}

func respondSupportGateway(c *gin.Context, request service.SupportGatewayRequest) {
	gateway, err := service.NewSupportGatewayFromEnvironment()
	if err != nil {
		writeSupportGatewayError(c, err)
		return
	}
	response, err := gateway.Dispatch(c.Request.Context(), request)
	if err != nil {
		writeSupportGatewayError(c, err)
		return
	}
	common.ApiSuccess(c, response.Data)
}

func writeSupportInputError(c *gin.Context) {
	c.JSON(http.StatusBadRequest, gin.H{
		"success": false,
		"code":    "SUPPORT_INVALID_REQUEST",
		"message": "客服请求参数无效",
	})
}

func writeSupportGatewayError(c *gin.Context, err error) {
	status := http.StatusServiceUnavailable
	code := "SUPPORT_GATEWAY_UNAVAILABLE"
	message := "客服服务暂时不可用，请稍后再试"
	if errors.Is(err, service.ErrSupportGatewayRejected) {
		status = http.StatusBadGateway
		code = "SUPPORT_GATEWAY_REJECTED"
		message = "客服服务暂时无法处理此请求，请稍后再试"
	}
	c.JSON(status, gin.H{
		"success": false,
		"code":    code,
		"message": message,
	})
}

func supportPageContextFromQuery(c *gin.Context) (service.SupportGatewayPageContext, error) {
	input := &supportPageInput{
		Path:      c.Query("page_path"),
		Title:     c.Query("page_title"),
		Section:   c.Query("page_section"),
		RequestID: c.Query("request_id"),
	}
	return normalizeSupportPageContext(input)
}

func normalizeSupportPageContext(input *supportPageInput) (service.SupportGatewayPageContext, error) {
	if input == nil {
		return service.SupportGatewayPageContext{}, errors.New("support page context is required")
	}
	path, err := normalizeSupportPagePath(input.Path)
	if err != nil {
		return service.SupportGatewayPageContext{}, err
	}
	title, err := normalizeSupportContextValue(input.Title, maxSupportPageTitleRunes)
	if err != nil {
		return service.SupportGatewayPageContext{}, err
	}
	section, err := normalizeSupportContextValue(input.Section, maxSupportPageSectionRunes)
	if err != nil {
		return service.SupportGatewayPageContext{}, err
	}
	requestID, err := normalizeSupportContextValue(input.RequestID, maxSupportRequestIDRunes)
	if err != nil {
		return service.SupportGatewayPageContext{}, err
	}
	return service.SupportGatewayPageContext{
		Path:      path,
		Title:     title,
		Section:   section,
		RequestID: requestID,
	}, nil
}

func normalizeSupportPagePath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" || utf8.RuneCountInString(path) > maxSupportPagePathRunes || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.Contains(path, "\\") {
		return "", errors.New("invalid support page path")
	}
	parsed, err := url.ParseRequestURI(path)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != path {
		return "", errors.New("invalid support page path")
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == ".." {
			return "", errors.New("invalid support page path")
		}
	}
	return path, nil
}

func normalizeSupportContextValue(raw string, maxRunes int) (string, error) {
	value := strings.TrimSpace(raw)
	if utf8.RuneCountInString(value) > maxRunes {
		return "", errors.New("support context exceeds limit")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", errors.New("support context contains a control character")
		}
	}
	return value, nil
}

func normalizeSupportMessageText(text, legacyContent string) (string, error) {
	normalizedText := strings.TrimSpace(text)
	normalizedLegacyContent := strings.TrimSpace(legacyContent)
	if normalizedText == "" {
		normalizedText = normalizedLegacyContent
	} else if normalizedLegacyContent != "" && normalizedText != normalizedLegacyContent {
		return "", errors.New("ambiguous support message text")
	}
	if normalizedText == "" || utf8.RuneCountInString(normalizedText) > maxSupportMessageRunes {
		return "", errors.New("support message text is invalid")
	}
	for _, r := range normalizedText {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return "", errors.New("support message contains a control character")
		}
	}
	return normalizedText, nil
}

func normalizeSupportClientMessageID(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > maxSupportClientMessageIDLen {
		return "", errors.New("support client message id is invalid")
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == ':') {
			return "", errors.New("support client message id is invalid")
		}
	}
	return value, nil
}

func supportMessageListQuery(c *gin.Context) (string, int, error) {
	cursor := strings.TrimSpace(c.Query("cursor"))
	if len(cursor) > maxSupportCursorLen {
		return "", 0, errors.New("support cursor exceeds limit")
	}
	for _, r := range cursor {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '~' || r == '=') {
			return "", 0, errors.New("support cursor is invalid")
		}
	}

	limit := defaultSupportMessageLimit
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil || parsedLimit < 1 || parsedLimit > maxSupportMessageListLimit {
			return "", 0, errors.New("support message list limit is invalid")
		}
		limit = parsedLimit
	}
	return cursor, limit, nil
}
