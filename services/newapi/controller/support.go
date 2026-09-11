package controller

import (
	"errors"
	"io"
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
	maxSupportMessageRunes          = 4000
	maxSupportPagePathRunes         = 512
	maxSupportPageTitleRunes        = 160
	maxSupportPageSectionRunes      = 80
	maxSupportRequestIDRunes        = 128
	maxSupportClientMessageIDLen    = 128
	maxSupportCursorLen             = 256
	maxSupportMessageListLimit      = 50
	defaultSupportMessageLimit      = 50
	maxSupportMessageBodyBytes      = 16 << 10
	maxSupportImageMessageBodyBytes = 4718592
	maxSupportImageDataBytes        = 4718592
)

type supportPageInput struct {
	Path      string `json:"path"`
	Title     string `json:"title,omitempty"`
	Section   string `json:"section,omitempty"`
	RequestID string `json:"request_id,omitempty"`
}

type supportMessageWriteRequest struct {
	Text            string            `json:"text"`
	Content         string            `json:"content,omitempty"`
	ClientMessageID string            `json:"client_message_id"`
	Page            *supportPageInput `json:"page,omitempty"`
	MessageType     string            `json:"message_type,omitempty"`
	ImageData       string            `json:"image_data,omitempty"`
}

type parsedSupportMessageWrite struct {
	text            string
	clientMessageID string
	messageType     string
	imageData       string
	page            *service.SupportGatewayPageContext
}

// GetAdminSupportConversations exposes the shared support inbox to an
// authenticated NewAPI administrator. The HMAC gateway remains the source of
// truth, so this route never queries or mirrors Supabase support data locally.
func GetAdminSupportConversations(c *gin.Context) {
	principal, ok := requireLiveAdminSupportGatewaySession(c)
	if !ok {
		return
	}
	cursor, limit, err := supportMessageListQuery(c)
	if err != nil {
		writeSupportInputError(c)
		return
	}
	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:    service.SupportGatewayActionAdminConversations,
		Principal: principal,
		Cursor:    cursor,
		Limit:     limit,
	})
}

// GetAdminSupportMessages returns one opaque conversation's message history.
// The conversation UUID is public to the NewAPI admin UI, while the gateway's
// random chat session_id remains private to the server-side bridge.
func GetAdminSupportMessages(c *gin.Context) {
	principal, ok := requireLiveAdminSupportGatewaySession(c)
	if !ok {
		return
	}
	conversationID, err := normalizeSupportConversationID(c.Param("conversation_id"))
	if err != nil {
		writeSupportInputError(c)
		return
	}
	cursor, limit, err := supportMessageListQuery(c)
	if err != nil {
		writeSupportInputError(c)
		return
	}
	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:         service.SupportGatewayActionAdminMessages,
		Principal:      principal,
		ConversationID: conversationID,
		Cursor:         cursor,
		Limit:          limit,
	})
}

// CreateAdminSupportMessage lets an administrator reply from NewAPI. The
// resulting row is still written to chat_messages by the shared gateway, so
// Fatherkey Admin Studio receives it through its existing realtime channel.
func CreateAdminSupportMessage(c *gin.Context) {
	principal, ok := requireLiveAdminSupportGatewaySession(c)
	if !ok {
		return
	}
	conversationID, err := normalizeSupportConversationID(c.Param("conversation_id"))
	if err != nil {
		writeSupportInputError(c)
		return
	}
	parsed, err := readSupportMessageWrite(c, false)
	if err != nil {
		writeSupportInputError(c)
		return
	}

	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:          service.SupportGatewayActionAdminSend,
		Principal:       principal,
		ConversationID:  conversationID,
		Page:            parsed.page,
		Text:            parsed.text,
		MessageType:     parsed.gatewayMessageType(),
		ImageData:       parsed.imageData,
		ClientMessageID: parsed.clientMessageID,
	})
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
	parsed, err := readSupportMessageWrite(c, true)
	if err != nil {
		writeSupportInputError(c)
		return
	}

	respondSupportGateway(c, service.SupportGatewayRequest{
		Action:          service.SupportGatewayActionSend,
		Principal:       principal,
		Page:            parsed.page,
		Text:            parsed.text,
		MessageType:     parsed.gatewayMessageType(),
		ImageData:       parsed.imageData,
		ClientMessageID: parsed.clientMessageID,
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

func requireLiveAdminSupportGatewaySession(c *gin.Context) (service.SupportGatewayPrincipal, bool) {
	principal, ok := requireLiveSupportGatewaySession(c)
	if !ok {
		return service.SupportGatewayPrincipal{}, false
	}
	if c.GetInt("role") < common.RoleAdminUser {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"code":    "SUPPORT_ADMIN_REQUIRED",
			"message": "管理员权限是客服收件箱所必需的",
		})
		return service.SupportGatewayPrincipal{}, false
	}
	return principal, true
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
	if errors.Is(err, service.ErrSupportImageUploadFailed) {
		status = http.StatusBadGateway
		code = "SUPPORT_IMAGE_UPLOAD_FAILED"
		message = "图片发送失败，请稍后重试"
	} else if errors.Is(err, service.ErrSupportGatewayRejected) {
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

func (parsed parsedSupportMessageWrite) gatewayMessageType() string {
	if parsed.messageType == "image" {
		return "image"
	}
	return ""
}

func readSupportRequestBody(c *gin.Context) ([]byte, error) {
	if c.Request.Body == nil {
		return nil, errors.New("support message body is required")
	}
	return io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, maxSupportImageMessageBodyBytes))
}

func readSupportMessageWrite(c *gin.Context, pageRequired bool) (parsedSupportMessageWrite, error) {
	body, err := readSupportRequestBody(c)
	if err != nil {
		return parsedSupportMessageWrite{}, err
	}
	return parseSupportMessageWrite(body, pageRequired)
}

func parseSupportMessageWrite(body []byte, pageRequired bool) (parsedSupportMessageWrite, error) {
	var input supportMessageWriteRequest
	if err := common.Unmarshal(body, &input); err != nil {
		return parsedSupportMessageWrite{}, err
	}
	messageType, err := normalizeSupportMessageType(input.MessageType)
	if err != nil {
		return parsedSupportMessageWrite{}, err
	}
	if messageType != "image" && int64(len(body)) > maxSupportMessageBodyBytes {
		return parsedSupportMessageWrite{}, errors.New("support message body is too large")
	}
	clientMessageID, err := normalizeSupportClientMessageID(input.ClientMessageID)
	if err != nil {
		return parsedSupportMessageWrite{}, err
	}

	parsed := parsedSupportMessageWrite{
		clientMessageID: clientMessageID,
		messageType:     messageType,
	}
	if messageType == "image" {
		imageData, imageErr := normalizeSupportImageData(input.ImageData)
		if imageErr != nil {
			return parsedSupportMessageWrite{}, imageErr
		}
		parsed.imageData = imageData
	} else {
		text, textErr := normalizeSupportMessageText(input.Text, input.Content)
		if textErr != nil {
			return parsedSupportMessageWrite{}, textErr
		}
		parsed.text = text
	}

	if pageRequired {
		page, pageErr := normalizeSupportPageContext(input.Page)
		if pageErr != nil {
			return parsedSupportMessageWrite{}, pageErr
		}
		parsed.page = &page
		return parsed, nil
	}
	if input.Page != nil {
		page, pageErr := normalizeSupportPageContext(input.Page)
		if pageErr != nil {
			return parsedSupportMessageWrite{}, pageErr
		}
		parsed.page = &page
	}
	return parsed, nil
}

func normalizeSupportMessageType(raw string) (string, error) {
	value := strings.TrimSpace(strings.ToLower(raw))
	if value == "" || value == "text" {
		return "text", nil
	}
	if value == "image" {
		return "image", nil
	}
	return "", errors.New("support message type is invalid")
}

func normalizeSupportImageData(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" || len(value) > maxSupportImageDataBytes {
		return "", errors.New("support image data is invalid")
	}
	prefix, data, ok := strings.Cut(value, ";base64,")
	if !ok || data == "" || !strings.HasPrefix(prefix, "data:image/") {
		return "", errors.New("support image data is invalid")
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

func normalizeSupportConversationID(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if len(value) != 36 || utf8.RuneCountInString(value) != 36 {
		return "", errors.New("support conversation id is invalid")
	}
	for index, r := range value {
		switch index {
		case 8, 13, 18, 23:
			if r != '-' {
				return "", errors.New("support conversation id is invalid")
			}
			continue
		case 14:
			if !(r >= '1' && r <= '5') {
				return "", errors.New("support conversation id is invalid")
			}
		case 19:
			if !((r >= '8' && r <= '9') || (r >= 'a' && r <= 'b') || (r >= 'A' && r <= 'B')) {
				return "", errors.New("support conversation id is invalid")
			}
		}
		if !((r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') || (r >= '0' && r <= '9')) {
			return "", errors.New("support conversation id is invalid")
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
