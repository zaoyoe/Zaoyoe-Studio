package main

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCompareNativeSchedulerShadowDoesNotCompareCredentials(t *testing.T) {
	plan := nativeSchedulerPlan{Version: nativeSchedulerPlanVersion, Channels: []nativeChannelPlan{{
		SourceAccountID: 7,
		Name:            "NewAPI native - account-7",
		Type:            constant.ChannelTypeOpenAI,
		BaseURL:         "https://upstream.test/v1",
		Models:          []string{"model-a"},
		Groups:          []string{"default"},
		ModelMapping:    map[string]string{"alias": "model-a"},
		Status:          common.ChannelStatusEnabled,
		Priority:        12,
		Weight:          3,
		Tag:             "sub2api-native:7",
	}}}
	actual := []nativeSchedulerShadowChannel{{
		ID: 101, Type: constant.ChannelTypeOpenAI, Name: "NewAPI native - account-7",
		Status: common.ChannelStatusEnabled, Weight: 3, BaseURL: "https://upstream.test/v1",
		Models: "model-a", Group: "default", ModelMapping: `{"alias":"model-a"}`,
		Priority: 12, Tag: "sub2api-native:7",
	}}
	report := compareNativeSchedulerShadow(plan, actual, time.Unix(0, 0))
	assert.Equal(t, 1, report.Matched)
	assert.Zero(t, report.Missing)
	assert.Zero(t, report.Mismatched)
	assert.Zero(t, report.Unexpected)
}

func TestCompareNativeSchedulerShadowReportsMissingMismatchedAndUnexpected(t *testing.T) {
	plan := nativeSchedulerPlan{Version: nativeSchedulerPlanVersion, Channels: []nativeChannelPlan{{
		SourceAccountID: 7, Name: "expected", Type: constant.ChannelTypeOpenAI,
		BaseURL: "https://upstream.test", Models: []string{"model-a"}, Groups: []string{"default"},
		Status: common.ChannelStatusEnabled, Priority: 12, Weight: 0, Tag: "sub2api-native:7",
	}, {
		SourceAccountID: 8, Name: "missing", Type: constant.ChannelTypeAnthropic,
		BaseURL: "https://anthropic.test", Models: []string{"claude"}, Groups: []string{"default"},
		Status: common.ChannelStatusManuallyDisabled, Priority: 11, Weight: 0, Tag: "sub2api-native:8",
	}}}
	actual := []nativeSchedulerShadowChannel{{
		ID: 101, Type: constant.ChannelTypeOpenAI, Name: "wrong-name", Status: common.ChannelStatusEnabled,
		BaseURL: "https://upstream.test", Models: "model-b", Group: "default", Priority: 9, Tag: "sub2api-native:7",
	}, {
		ID: 102, Type: constant.ChannelTypeOpenAI, Name: "unexpected", Status: common.ChannelStatusEnabled,
		Tag: "sub2api-native:99",
	}}
	report := compareNativeSchedulerShadow(plan, actual, time.Unix(0, 0))
	assert.Equal(t, 0, report.Matched)
	assert.Equal(t, 1, report.Missing)
	assert.GreaterOrEqual(t, report.Mismatched, 1)
	assert.Equal(t, 1, report.Unexpected)
	for _, issue := range report.Issues {
		assert.NotEmpty(t, issue.Tag)
	}
}

func TestCanonicalJSONStringRejectsMalformedMapping(t *testing.T) {
	assert.Equal(t, `{"alias":"model-a"}`, canonicalJSONString(`{"alias":"model-a"}`))
	assert.Equal(t, "", canonicalJSONString("null"))
	assert.Equal(t, "<invalid>", canonicalJSONString(`{"alias":123}`))
	_, err := stringMapValueFromJSONString(`[]`)
	require.Error(t, err)
}
