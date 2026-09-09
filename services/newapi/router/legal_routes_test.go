package router

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestLegalDocumentRoutesUseFixedPublicPaths(t *testing.T) {
	previousMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() {
		gin.SetMode(previousMode)
	})

	engine := gin.New()
	SetApiRouter(engine)

	routes := make(map[string]struct{}, len(engine.Routes()))
	for _, route := range engine.Routes() {
		routes[route.Method+" "+route.Path] = struct{}{}
	}
	for _, path := range []string{
		"/api/user-agreement",
		"/api/privacy-policy",
		"/api/acceptable-use",
		"/api/refund-policy",
		"/api/restricted-regions",
	} {
		_, exists := routes[http.MethodGet+" "+path]
		assert.True(t, exists, path)
	}
	_, hasWildcardLegalRoute := routes[http.MethodGet+" /api/legal/:document"]
	assert.False(t, hasWildcardLegalRoute)
}
