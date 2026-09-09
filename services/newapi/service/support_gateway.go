package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
)

const (
	SupportGatewayURLEnv            = "NEWAPI_SUPPORT_GATEWAY_URL"
	SupportGatewayHMACSecretEnv     = "NEWAPI_SUPPORT_GATEWAY_HMAC_SECRET"
	SupportGatewayTimeoutSecondsEnv = "NEWAPI_SUPPORT_GATEWAY_TIMEOUT_SECONDS"

	supportGatewayProduct          = "newapi"
	supportGatewayProtocolVersion  = 1
	defaultSupportGatewayTimeout   = 8 * time.Second
	maxSupportGatewayTimeout       = 30 * time.Second
	maxSupportGatewayResponseBytes = 1 << 20
	maxSupportGatewayLimit         = 50
	maxSupportGatewayCursorBytes   = 256
	maxSupportGatewayTextRunes     = 4000
	maxSupportGatewayTextBytes     = 16 << 10
	maxSupportGatewayClientIDBytes = 128
	maxSupportGatewayPagePathRunes = 512
)

var (
	ErrSupportGatewayNotConfigured = errors.New("support gateway is not configured")
	ErrSupportGatewayMisconfigured = errors.New("support gateway configuration is invalid")
	ErrSupportGatewayUnavailable   = errors.New("support gateway is unavailable")
	ErrSupportGatewayRejected      = errors.New("support gateway rejected the request")
)

type SupportGatewayAction string

const (
	SupportGatewayActionContext  SupportGatewayAction = "context"
	SupportGatewayActionMessages SupportGatewayAction = "messages"
	SupportGatewayActionSend     SupportGatewayAction = "send_message"
	// Admin actions use the same signed gateway and Supabase data boundary as
	// the user widget. The browser never receives the opaque session_id stored
	// by the gateway; it addresses a conversation by its public UUID instead.
	SupportGatewayActionAdminConversations SupportGatewayAction = "admin_conversations"
	SupportGatewayActionAdminMessages      SupportGatewayAction = "admin_messages"
	SupportGatewayActionAdminSend          SupportGatewayAction = "admin_send_message"
)

// SupportGatewayPrincipal deliberately contains no dashboard JWT, API key,
// refresh cookie, or browser session identifier. The shared support gateway
// uses product plus user_id as the stable conversation owner.
type SupportGatewayPrincipal struct {
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
	Email    string `json:"email,omitempty"`
}

type SupportGatewayPageContext struct {
	Path      string `json:"path"`
	Title     string `json:"title,omitempty"`
	Section   string `json:"section,omitempty"`
	RequestID string `json:"request_id,omitempty"`
}

// SupportGatewayRequest is the signed wire contract for the shared support
// service. The endpoint configured by NEWAPI_SUPPORT_GATEWAY_URL receives a
// POST for every action and must validate the HMAC headers before processing it.
type SupportGatewayRequest struct {
	Version         int                        `json:"version"`
	Product         string                     `json:"product"`
	Action          SupportGatewayAction       `json:"action"`
	Principal       SupportGatewayPrincipal    `json:"principal"`
	Page            *SupportGatewayPageContext `json:"page,omitempty"`
	Text            string                     `json:"text,omitempty"`
	ClientMessageID string                     `json:"client_message_id,omitempty"`
	Cursor          string                     `json:"cursor,omitempty"`
	Limit           int                        `json:"limit,omitempty"`
	ConversationID  string                     `json:"conversation_id,omitempty"`
}

// SupportGatewayResponse contains one of the action-specific data contracts
// below. The bridge does not forward arbitrary remote response bodies.
type SupportGatewayResponse struct {
	Success bool   `json:"success"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
	Data    any    `json:"data"`
}

// SupportGatewayContextData is returned for the context action.
// The gateway contract is data={conversation,messages,unread_count}.
type SupportGatewayContextData struct {
	Conversation any   `json:"conversation"`
	Messages     []any `json:"messages"`
	UnreadCount  int   `json:"unread_count"`
}

// SupportGatewayMessagesData is returned for the messages action.
// The gateway contract is data={messages,next_cursor}.
type SupportGatewayMessagesData struct {
	Messages   []any  `json:"messages"`
	NextCursor string `json:"next_cursor"`
}

// SupportGatewayAdminConversationsData is returned for the administrator
// conversation list. Conversation records intentionally contain no internal
// session_id; the gateway keeps that value private from browser clients.
type SupportGatewayAdminConversationsData struct {
	Conversations []any  `json:"conversations"`
	NextCursor    string `json:"next_cursor"`
}

type SupportGateway struct {
	endpoint *url.URL
	secret   []byte
	client   *http.Client
	now      func() time.Time
	nonce    func() (string, error)
}

// NewSupportGatewayFromEnvironment creates the outbound bridge from explicit
// deployment configuration. HTTPS is mandatory because the signed payload can
// contain support text and account contact information.
func NewSupportGatewayFromEnvironment() (*SupportGateway, error) {
	rawURL := strings.TrimSpace(os.Getenv(SupportGatewayURLEnv))
	secret := strings.TrimSpace(os.Getenv(SupportGatewayHMACSecretEnv))
	if rawURL == "" || secret == "" {
		return nil, ErrSupportGatewayNotConfigured
	}

	endpoint, err := url.Parse(rawURL)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" || endpoint.User != nil || endpoint.Fragment != "" {
		return nil, ErrSupportGatewayMisconfigured
	}

	timeout := defaultSupportGatewayTimeout
	if rawTimeout := strings.TrimSpace(os.Getenv(SupportGatewayTimeoutSecondsEnv)); rawTimeout != "" {
		seconds, parseErr := strconv.Atoi(rawTimeout)
		if parseErr != nil || seconds < 1 || time.Duration(seconds)*time.Second > maxSupportGatewayTimeout {
			return nil, ErrSupportGatewayMisconfigured
		}
		timeout = time.Duration(seconds) * time.Second
	}

	return newSupportGateway(endpoint, secret, &http.Client{
		Timeout: timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			// Do not forward a signed request to a redirect target.
			return http.ErrUseLastResponse
		},
	})
}

func newSupportGateway(endpoint *url.URL, secret string, client *http.Client) (*SupportGateway, error) {
	if endpoint == nil || endpoint.Scheme == "" || endpoint.Host == "" || strings.TrimSpace(secret) == "" || client == nil {
		return nil, ErrSupportGatewayMisconfigured
	}
	return &SupportGateway{
		endpoint: endpoint,
		secret:   []byte(secret),
		client:   client,
		now:      time.Now,
		nonce: func() (string, error) {
			return common.GenerateRandomCharsKey(32)
		},
	}, nil
}

func (gateway *SupportGateway) Dispatch(ctx context.Context, request SupportGatewayRequest) (*SupportGatewayResponse, error) {
	if gateway == nil || gateway.endpoint == nil || len(gateway.secret) == 0 || gateway.client == nil {
		return nil, ErrSupportGatewayNotConfigured
	}
	if !isSupportGatewayRequestValid(request) {
		return nil, ErrSupportGatewayRejected
	}

	request.Version = supportGatewayProtocolVersion
	request.Product = supportGatewayProduct
	payload, err := common.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("%w: could not encode request", ErrSupportGatewayUnavailable)
	}
	nonce, err := gateway.nonce()
	if err != nil || nonce == "" {
		return nil, fmt.Errorf("%w: could not generate request nonce", ErrSupportGatewayUnavailable)
	}
	timestamp := strconv.FormatInt(gateway.now().Unix(), 10)

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, gateway.endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("%w: could not create request", ErrSupportGatewayUnavailable)
	}
	httpRequest.Header.Set("Accept", "application/json")
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("X-NewAPI-Support-Version", strconv.Itoa(supportGatewayProtocolVersion))
	httpRequest.Header.Set("X-NewAPI-Support-Timestamp", timestamp)
	httpRequest.Header.Set("X-NewAPI-Support-Nonce", nonce)
	httpRequest.Header.Set("X-NewAPI-Support-Signature", supportGatewaySignature(gateway.secret, timestamp, nonce, payload))

	httpResponse, err := gateway.client.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf("%w: request failed", ErrSupportGatewayUnavailable)
	}
	defer httpResponse.Body.Close()

	responsePayload, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxSupportGatewayResponseBytes+1))
	if err != nil || len(responsePayload) > maxSupportGatewayResponseBytes {
		return nil, fmt.Errorf("%w: invalid response body", ErrSupportGatewayUnavailable)
	}
	if httpResponse.StatusCode < http.StatusOK || httpResponse.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("%w: unexpected response status", ErrSupportGatewayUnavailable)
	}

	var wireResponse struct {
		Success bool            `json:"success"`
		Code    string          `json:"code,omitempty"`
		Message string          `json:"message,omitempty"`
		Data    json.RawMessage `json:"data"`
	}
	if err := common.Unmarshal(responsePayload, &wireResponse); err != nil {
		return nil, fmt.Errorf("%w: invalid response payload", ErrSupportGatewayUnavailable)
	}
	if !wireResponse.Success {
		return nil, ErrSupportGatewayRejected
	}
	data, err := decodeSupportGatewayData(request.Action, wireResponse.Data)
	if err != nil {
		return nil, fmt.Errorf("%w: invalid response data", ErrSupportGatewayUnavailable)
	}
	return &SupportGatewayResponse{
		Success: true,
		Code:    wireResponse.Code,
		Message: wireResponse.Message,
		Data:    data,
	}, nil
}

func isSupportGatewayAction(action SupportGatewayAction) bool {
	switch action {
	case SupportGatewayActionContext, SupportGatewayActionMessages, SupportGatewayActionSend,
		SupportGatewayActionAdminConversations, SupportGatewayActionAdminMessages,
		SupportGatewayActionAdminSend:
		return true
	default:
		return false
	}
}

func isSupportGatewayRequestValid(request SupportGatewayRequest) bool {
	if request.Principal.UserID <= 0 || !isSupportGatewayAction(request.Action) {
		return false
	}
	switch request.Action {
	case SupportGatewayActionContext:
		return isSupportGatewayPageValid(request.Page, true)
	case SupportGatewayActionMessages:
		return isSupportGatewayListRequestValid(request.Limit, request.Cursor)
	case SupportGatewayActionSend:
		return isSupportGatewayPageValid(request.Page, true) && isSupportGatewayTextValid(request.Text) && isSupportGatewayClientMessageIDValid(request.ClientMessageID)
	case SupportGatewayActionAdminConversations:
		return isSupportGatewayListRequestValid(request.Limit, request.Cursor)
	case SupportGatewayActionAdminMessages:
		return isSupportGatewayUUID(request.ConversationID) && isSupportGatewayListRequestValid(request.Limit, request.Cursor)
	case SupportGatewayActionAdminSend:
		return isSupportGatewayUUID(request.ConversationID) && isSupportGatewayTextValid(request.Text) && isSupportGatewayClientMessageIDValid(request.ClientMessageID) && isSupportGatewayPageValid(request.Page, false)
	default:
		return false
	}
}

func isSupportGatewayListRequestValid(limit int, cursor string) bool {
	return limit >= 1 && limit <= maxSupportGatewayLimit && isSupportGatewayCursorValid(cursor)
}

func isSupportGatewayCursorValid(cursor string) bool {
	if len(cursor) > maxSupportGatewayCursorBytes {
		return false
	}
	for _, r := range cursor {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == '~' || r == '=') {
			return false
		}
	}
	return true
}

func isSupportGatewayPageValid(page *SupportGatewayPageContext, required bool) bool {
	if page == nil {
		return !required
	}
	path := strings.TrimSpace(page.Path)
	if path == "" || utf8.RuneCountInString(path) > maxSupportGatewayPagePathRunes || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.ContainsAny(path, `\\?#`) {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == ".." {
			return false
		}
	}
	return true
}

func isSupportGatewayTextValid(text string) bool {
	trimmed := strings.TrimSpace(text)
	return trimmed != "" && utf8.RuneCountInString(trimmed) <= maxSupportGatewayTextRunes && len([]byte(trimmed)) <= maxSupportGatewayTextBytes
}

func isSupportGatewayClientMessageIDValid(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxSupportGatewayClientIDBytes {
		return false
	}
	for index, r := range value {
		if index == 0 && !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' || r == ':') {
			return false
		}
	}
	return true
}

func isSupportGatewayUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, r := range value {
		switch index {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
			continue
		case 14:
			if r < '1' || r > '5' {
				return false
			}
		case 19:
			if !((r >= '8' && r <= '9') || (r >= 'a' && r <= 'b') || (r >= 'A' && r <= 'B')) {
				return false
			}
		}
		if !((r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func supportGatewaySignature(secret []byte, timestamp, nonce string, payload []byte) string {
	return common.GenerateHMACWithKey(secret, timestamp+"\n"+nonce+"\n"+string(payload))
}

func decodeSupportGatewayData(action SupportGatewayAction, raw json.RawMessage) (any, error) {
	fields, err := supportGatewayDataFields(raw)
	if err != nil {
		return nil, err
	}

	switch action {
	case SupportGatewayActionContext:
		conversationRaw, ok := fields["conversation"]
		if !ok {
			return nil, errors.New("support context conversation is missing")
		}
		messagesRaw, ok := fields["messages"]
		if !ok {
			return nil, errors.New("support context messages are missing")
		}
		unreadCountRaw, ok := fields["unread_count"]
		if !ok {
			return nil, errors.New("support context unread count is missing")
		}
		var conversation any
		var messages []any
		var unreadCount int
		if err := common.Unmarshal(conversationRaw, &conversation); err != nil {
			return nil, err
		}
		if err := common.Unmarshal(messagesRaw, &messages); err != nil || messages == nil {
			return nil, errors.New("support context messages are invalid")
		}
		if isSupportGatewayJSONNull(unreadCountRaw) || common.Unmarshal(unreadCountRaw, &unreadCount) != nil || unreadCount < 0 {
			return nil, errors.New("support context unread count is invalid")
		}
		return SupportGatewayContextData{
			Conversation: conversation,
			Messages:     messages,
			UnreadCount:  unreadCount,
		}, nil
	case SupportGatewayActionMessages:
		messagesRaw, ok := fields["messages"]
		if !ok {
			return nil, errors.New("support messages are missing")
		}
		nextCursorRaw, ok := fields["next_cursor"]
		if !ok {
			return nil, errors.New("support next cursor is missing")
		}
		var messages []any
		var nextCursor string
		if err := common.Unmarshal(messagesRaw, &messages); err != nil || messages == nil {
			return nil, errors.New("support messages are invalid")
		}
		if isSupportGatewayJSONNull(nextCursorRaw) || common.Unmarshal(nextCursorRaw, &nextCursor) != nil {
			return nil, errors.New("support next cursor is invalid")
		}
		return SupportGatewayMessagesData{Messages: messages, NextCursor: nextCursor}, nil
	case SupportGatewayActionSend:
		var message map[string]any
		if err := common.Unmarshal(raw, &message); err != nil || message == nil {
			return nil, errors.New("support message is invalid")
		}
		return message, nil
	case SupportGatewayActionAdminConversations:
		conversationsRaw, ok := fields["conversations"]
		if !ok {
			return nil, errors.New("support admin conversations are missing")
		}
		nextCursorRaw, ok := fields["next_cursor"]
		if !ok {
			return nil, errors.New("support admin next cursor is missing")
		}
		var conversations []any
		var nextCursor string
		if err := common.Unmarshal(conversationsRaw, &conversations); err != nil || conversations == nil {
			return nil, errors.New("support admin conversations are invalid")
		}
		if isSupportGatewayJSONNull(nextCursorRaw) || common.Unmarshal(nextCursorRaw, &nextCursor) != nil {
			return nil, errors.New("support admin next cursor is invalid")
		}
		return SupportGatewayAdminConversationsData{Conversations: conversations, NextCursor: nextCursor}, nil
	case SupportGatewayActionAdminMessages:
		messagesRaw, ok := fields["messages"]
		if !ok {
			return nil, errors.New("support admin messages are missing")
		}
		nextCursorRaw, ok := fields["next_cursor"]
		if !ok {
			return nil, errors.New("support admin next cursor is missing")
		}
		var messages []any
		var nextCursor string
		if err := common.Unmarshal(messagesRaw, &messages); err != nil || messages == nil {
			return nil, errors.New("support admin messages are invalid")
		}
		if isSupportGatewayJSONNull(nextCursorRaw) || common.Unmarshal(nextCursorRaw, &nextCursor) != nil {
			return nil, errors.New("support admin next cursor is invalid")
		}
		return SupportGatewayMessagesData{Messages: messages, NextCursor: nextCursor}, nil
	case SupportGatewayActionAdminSend:
		var message map[string]any
		if err := common.Unmarshal(raw, &message); err != nil || message == nil {
			return nil, errors.New("support admin message is invalid")
		}
		return message, nil
	default:
		return nil, errors.New("unsupported support gateway action")
	}
}

func supportGatewayDataFields(raw json.RawMessage) (map[string]json.RawMessage, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil, errors.New("support response data is missing")
	}
	fields := make(map[string]json.RawMessage)
	if err := common.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, errors.New("support response data is invalid")
	}
	return fields, nil
}

func isSupportGatewayJSONNull(raw json.RawMessage) bool {
	return bytes.Equal(bytes.TrimSpace(raw), []byte("null"))
}
