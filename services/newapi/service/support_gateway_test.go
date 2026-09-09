package service

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSupportGatewayDispatchSignsRequestAndOnlySendsSupportPrincipal(t *testing.T) {
	const secret = "support-gateway-test-secret"
	const nonce = "nonce-for-test-request"
	now := time.Unix(1_725_000_000, 0)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		require.Equal(t, http.MethodPost, request.Method)
		require.Equal(t, "application/json", request.Header.Get("Content-Type"))
		require.Equal(t, "1", request.Header.Get("X-NewAPI-Support-Version"))
		require.Equal(t, "1725000000", request.Header.Get("X-NewAPI-Support-Timestamp"))
		require.Equal(t, nonce, request.Header.Get("X-NewAPI-Support-Nonce"))

		body := readSupportGatewayTestBody(t, request)
		assert.Equal(t, supportGatewaySignature([]byte(secret), "1725000000", nonce, body), request.Header.Get("X-NewAPI-Support-Signature"))
		assert.NotContains(t, string(body), "session_id")
		assert.NotContains(t, string(body), "access_token")
		assert.NotContains(t, string(body), "refresh_token")
		assert.NotContains(t, string(body), "api_key")

		var payload SupportGatewayRequest
		require.NoError(t, common.Unmarshal(body, &payload))
		assert.Equal(t, supportGatewayProtocolVersion, payload.Version)
		assert.Equal(t, supportGatewayProduct, payload.Product)
		assert.Equal(t, SupportGatewayActionSend, payload.Action)
		assert.Equal(t, 42, payload.Principal.UserID)
		assert.Equal(t, "newapi-user", payload.Principal.Username)
		assert.Equal(t, "user@example.com", payload.Principal.Email)
		require.NotNil(t, payload.Page)
		assert.Equal(t, "/dashboard/keys", payload.Page.Path)
		assert.Equal(t, "How do I rotate a key?", payload.Text)
		assert.Equal(t, "msg-123", payload.ClientMessageID)

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"success":true,"data":{"id":"support-1"}}`))
	}))
	defer server.Close()

	endpoint, err := url.Parse(server.URL)
	require.NoError(t, err)
	gateway, err := newSupportGateway(endpoint, secret, server.Client())
	require.NoError(t, err)
	gateway.now = func() time.Time { return now }
	gateway.nonce = func() (string, error) { return nonce, nil }

	response, err := gateway.Dispatch(t.Context(), SupportGatewayRequest{
		Action: SupportGatewayActionSend,
		Principal: SupportGatewayPrincipal{
			UserID:   42,
			Username: "newapi-user",
			Email:    "user@example.com",
		},
		Page:            &SupportGatewayPageContext{Path: "/dashboard/keys"},
		Text:            "How do I rotate a key?",
		ClientMessageID: "msg-123",
	})

	require.NoError(t, err)
	require.NotNil(t, response)
	assert.True(t, response.Success)
	data, ok := response.Data.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "support-1", data["id"])
}

func TestSupportGatewayDispatchFailsClosedForGatewayFailure(t *testing.T) {
	tests := []struct {
		name      string
		response  string
		status    int
		wantError error
	}{
		{
			name:      "gateway rejects request",
			status:    http.StatusOK,
			response:  `{"success":false,"code":"NOT_ALLOWED","message":"do not expose this"}`,
			wantError: ErrSupportGatewayRejected,
		},
		{
			name:      "gateway sends malformed response",
			status:    http.StatusOK,
			response:  `not-json`,
			wantError: ErrSupportGatewayUnavailable,
		},
		{
			name:      "gateway returns server error",
			status:    http.StatusInternalServerError,
			response:  `{"error":"internal"}`,
			wantError: ErrSupportGatewayUnavailable,
		},
		{
			name:      "gateway violates the messages response contract",
			status:    http.StatusOK,
			response:  `{"success":true,"data":{"message":{"id":"wrong-shape"}}}`,
			wantError: ErrSupportGatewayUnavailable,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(test.response))
			}))
			defer server.Close()

			endpoint, err := url.Parse(server.URL)
			require.NoError(t, err)
			gateway, err := newSupportGateway(endpoint, "test-secret", server.Client())
			require.NoError(t, err)

			_, err = gateway.Dispatch(t.Context(), SupportGatewayRequest{
				Action:    SupportGatewayActionMessages,
				Principal: SupportGatewayPrincipal{UserID: 7},
				Limit:     50,
			})

			require.Error(t, err)
			assert.True(t, errors.Is(err, test.wantError))
			assert.NotContains(t, err.Error(), "do not expose this")
		})
	}
}

func TestNewSupportGatewayFromEnvironmentRequiresHTTPSAndSecret(t *testing.T) {
	t.Setenv(SupportGatewayURLEnv, "")
	t.Setenv(SupportGatewayHMACSecretEnv, "")
	_, err := NewSupportGatewayFromEnvironment()
	require.ErrorIs(t, err, ErrSupportGatewayNotConfigured)

	t.Setenv(SupportGatewayURLEnv, "http://support.example.test/bridge")
	t.Setenv(SupportGatewayHMACSecretEnv, "test-secret")
	_, err = NewSupportGatewayFromEnvironment()
	require.ErrorIs(t, err, ErrSupportGatewayMisconfigured)

	t.Setenv(SupportGatewayURLEnv, "https://support.example.test/bridge#fragment")
	_, err = NewSupportGatewayFromEnvironment()
	require.ErrorIs(t, err, ErrSupportGatewayMisconfigured)

	t.Setenv(SupportGatewayURLEnv, "https://support.example.test/bridge")
	t.Setenv(SupportGatewayTimeoutSecondsEnv, "31")
	_, err = NewSupportGatewayFromEnvironment()
	require.ErrorIs(t, err, ErrSupportGatewayMisconfigured)
}

func readSupportGatewayTestBody(t *testing.T, request *http.Request) []byte {
	t.Helper()
	body, err := io.ReadAll(request.Body)
	require.NoError(t, err)
	return body
}
