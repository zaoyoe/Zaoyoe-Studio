package controller

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	secureVerificationMethod2FA      = "2fa"
	secureVerificationMethodPasskey  = "passkey"
	secureVerificationMethodPassword = "password"
	securityProofScopeAPIKeyCreate   = "api_key.create"
)

type UniversalVerifyRequest struct {
	Method   string `json:"method"`
	Code     string `json:"code,omitempty"`
	Password string `json:"password,omitempty"`
	Scope    string `json:"scope"`
}

func UniversalVerify(c *gin.Context) {
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "当前认证方式不支持安全验证"})
		return
	}
	var request UniversalVerifyRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, fmt.Errorf("参数错误: %v", err))
		return
	}
	if !isAllowedSecurityProofScope(request.Scope) {
		common.ApiError(c, errors.New("不支持的安全验证范围"))
		return
	}

	switch request.Method {
	case secureVerificationMethod2FA:
		if strings.TrimSpace(request.Code) == "" {
			common.ApiError(c, errors.New("验证码不能为空"))
			return
		}
		twoFA, err := model.GetTwoFAByUserId(identity.UserID)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if twoFA == nil || !twoFA.IsEnabled {
			common.ApiError(c, errors.New("用户未启用2FA"))
			return
		}
		if !validateTwoFactorAuth(twoFA, request.Code) {
			common.ApiError(c, errors.New("验证失败，请检查验证码"))
			return
		}
	case secureVerificationMethodPassword:
		if strings.TrimSpace(request.Password) == "" {
			common.ApiErrorI18n(c, i18n.MsgUserUsernameOrPasswordEmpty)
			return
		}
		if request.Scope != securityProofScopeAPIKeyCreate {
			common.ApiError(c, errors.New("不支持的安全验证范围"))
			return
		}
		user, err := model.GetUserById(identity.UserID, true)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if user.Password == "" {
			common.ApiErrorI18n(c, i18n.MsgUserPasswordUnset)
			return
		}
		if !common.ValidatePasswordAndHash(request.Password, user.Password) {
			common.ApiErrorI18n(c, i18n.MsgUserOriginalPasswordError)
			return
		}
	default:
		common.ApiError(c, errors.New("Passkey 验证必须使用 Passkey verify 流程"))
		return
	}
	proofToken, expiresAt, err := service.IssueSecurityProof(identity, request.Method, []string{request.Scope})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(identity.UserID, model.LogTypeSystem, fmt.Sprintf("通用安全验证成功 (验证方式: %s)", request.Method))
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "验证成功",
		"data": gin.H{
			"proof_token": proofToken,
			"expires_at":  expiresAt,
			"method":      request.Method,
			"scope":       request.Scope,
		},
	})
}

func isAllowedSecurityProofScope(scope string) bool {
	switch scope {
	case securityProofScopeChannelKeyRead, securityProofScopePasskeyRegister, securityProofScopePasskeyDelete, securityProofScopeAPIKeyCreate:
		return true
	default:
		return false
	}
}
