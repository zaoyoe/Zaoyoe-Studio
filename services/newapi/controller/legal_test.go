package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLegalDocumentHandlersReturnOnlyTheirConfiguredDocument(t *testing.T) {
	previousMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		gin.SetMode(previousMode)
	})

	settings := system_setting.GetLegalSettings()
	originalSettings := *settings
	t.Cleanup(func() {
		*settings = originalSettings
	})
	*settings = system_setting.LegalSettings{
		UserAgreement:     "terms-content",
		PrivacyPolicy:     "privacy-content",
		AcceptableUse:     "acceptable-use-content",
		RefundPolicy:      "refund-content",
		RestrictedRegions: "restricted-regions-content",
	}

	tests := []struct {
		name        string
		handler     gin.HandlerFunc
		wantContent string
	}{
		{name: "user agreement", handler: GetUserAgreement, wantContent: "terms-content"},
		{name: "privacy policy", handler: GetPrivacyPolicy, wantContent: "privacy-content"},
		{name: "acceptable use", handler: GetAcceptableUse, wantContent: "acceptable-use-content"},
		{name: "refund policy", handler: GetRefundPolicy, wantContent: "refund-content"},
		{name: "restricted regions", handler: GetRestrictedRegions, wantContent: "restricted-regions-content"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			test.handler(context)

			assert.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Success bool   `json:"success"`
				Message string `json:"message"`
				Data    string `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.True(t, payload.Success)
			assert.Empty(t, payload.Message)
			assert.Equal(t, test.wantContent, payload.Data)
		})
	}
}
