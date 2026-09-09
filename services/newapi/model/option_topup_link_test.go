package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTopUpLinkNormalizesFatherKeyBareDomain(t *testing.T) {
	normalized, err := normalizeOptionValue("TopUpLink", " Fatherkey.com/ ")
	require.NoError(t, err)
	assert.Equal(t, "https://fatherkey.com", normalized)

	common.OptionMapRWMutex.Lock()
	previousOptionMap := common.OptionMap
	previousTopUpLink := common.TopUpLink
	common.OptionMap = make(map[string]string)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptionMap
		common.TopUpLink = previousTopUpLink
		common.OptionMapRWMutex.Unlock()
	})

	require.NoError(t, updateOptionMap("TopUpLink", "www.Fatherkey.com"))
	assert.Equal(t, "https://fatherkey.com", common.TopUpLink)
	assert.Equal(t, "https://fatherkey.com", common.OptionMap["TopUpLink"])
}

func TestTopUpLinkKeepsAbsoluteExternalURL(t *testing.T) {
	normalized, err := normalizeOptionValue("TopUpLink", " https://example.com/codes ")
	require.NoError(t, err)
	assert.Equal(t, "https://example.com/codes", normalized)
}
