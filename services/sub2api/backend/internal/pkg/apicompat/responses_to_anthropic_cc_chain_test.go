package apicompat

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// These tests drive the exact production path for Chat Completions clients on an
// Anthropic-platform group: ForwardAsChatCompletions runs
// ChatCompletionsToResponses → ResponsesToAnthropicRequest
// (gateway_forward_as_chat_completions.go), then forwards the Anthropic body
// upstream. They assert the tool-pairing repair holds through that full chain,
// not only for codex-style Responses input.
func ccChainToAnthropic(t *testing.T, ccReq *ChatCompletionsRequest) []AnthropicMessage {
	t.Helper()
	respReq, err := ChatCompletionsToResponses(ccReq)
	require.NoError(t, err)
	anthReq, err := ResponsesToAnthropicRequest(respReq)
	require.NoError(t, err)
	assertAnthropicPairing(t, anthReq.Messages)
	return anthReq.Messages
}

func TestCCChain_DataURIImageSurvivesAnthropicCompatibilityConversion(t *testing.T) {
	msgs := ccChainToAnthropic(t, &ChatCompletionsRequest{
		Model: "claude-opus-4-6",
		Messages: []ChatMessage{{
			Role: "user",
			Content: json.RawMessage(`[
				{"type":"text","text":"Reverse this image into a prompt"},
				{"type":"image_url","image_url":{"url":"data:image/png;base64,aW1hZ2UtYnl0ZXM="}}
			]`),
		}},
	})

	require.Len(t, msgs, 1)
	blocks := parseContentBlocks(msgs[0].Content)
	require.Len(t, blocks, 2)
	require.Equal(t, "text", blocks[0].Type)
	require.Equal(t, "image", blocks[1].Type)
	require.NotNil(t, blocks[1].Source)
	require.Equal(t, "base64", blocks[1].Source.Type)
	require.Equal(t, "image/png", blocks[1].Source.MediaType)
	require.Equal(t, "aW1hZ2UtYnl0ZXM=", blocks[1].Source.Data)
}

func TestCCChain_GeminiThinkingEffortPreservesEnabledAndDisabledModes(t *testing.T) {
	tests := []struct {
		name         string
		effort       string
		wantEffort   string
		wantThinking string
	}{
		{name: "minimal maps to low", effort: "minimal", wantEffort: "low", wantThinking: "enabled"},
		{name: "low stays enabled", effort: "low", wantEffort: "low", wantThinking: "enabled"},
		{name: "medium stays enabled", effort: "medium", wantEffort: "medium", wantThinking: "enabled"},
		{name: "high stays enabled", effort: "high", wantEffort: "high", wantThinking: "enabled"},
		{name: "none disables", effort: "none", wantEffort: "none", wantThinking: "disabled"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			responsesReq, err := ChatCompletionsToResponses(&ChatCompletionsRequest{
				Model:           "gemini-3.5-flash",
				ReasoningEffort: tt.effort,
				Messages:        []ChatMessage{{Role: "user", Content: json.RawMessage(`"请回答"`)}},
			})
			require.NoError(t, err)
			anthropicReq, err := ResponsesToAnthropicRequest(responsesReq)
			require.NoError(t, err)
			require.NotNil(t, anthropicReq.OutputConfig)
			require.Equal(t, tt.wantEffort, anthropicReq.OutputConfig.Effort)
			require.NotNil(t, anthropicReq.Thinking)
			require.Equal(t, tt.wantThinking, anthropicReq.Thinking.Type)
		})
	}
}

// Reproduces the production 400:
//
//	unexpected ...content.0: tool_use_id found in tool_result blocks:
//	call_00_TgfbRvKlnD7oK6Dg00sL1661. Each tool_result block must have a
//	corresponding tool_use block in the previous message.
//
// A Chat Completions client trimmed its history and kept a tool result whose
// announcing assistant tool_calls message was dropped (sliding-window context
// management). The orphan tool_result has no matching tool_use → upstream 400.
// The repair drops the orphan so the request is valid.
func TestCCChain_OrphanToolResultFromTrimmedHistory(t *testing.T) {
	orphanID := "call_00_TgfbRvKlnD7oK6Dg00sL1661"
	msgs := ccChainToAnthropic(t, &ChatCompletionsRequest{
		Model: "deepseek-v4-pro",
		Messages: []ChatMessage{
			{Role: "user", Content: json.RawMessage(`"search the web for X"`)},
			// The assistant tool_calls message that announced orphanID was trimmed.
			{Role: "tool", ToolCallID: orphanID, Content: json.RawMessage(`"stale search results"`)},
			{Role: "assistant", Content: json.RawMessage(`"Here is what I found."`)},
			{Role: "user", Content: json.RawMessage(`"thanks, now do Y"`)},
		},
	})
	for _, m := range msgs {
		require.Falsef(t, hasToolResult(parseContentBlocks(m.Content), orphanID),
			"orphan tool_result %s should have been dropped", orphanID)
	}
}

// A parallel web_search where one sibling's result never came back (the tool
// failed/was skipped). The unanswered tool_use would otherwise trip Anthropic's
// "tool_use without tool_result" check; the repair drops it.
func TestCCChain_ParallelToolOneResultMissing(t *testing.T) {
	msgs := ccChainToAnthropic(t, &ChatCompletionsRequest{
		Model: "deepseek-v4-pro",
		Messages: []ChatMessage{
			{Role: "user", Content: json.RawMessage(`"search A and B"`)},
			{Role: "assistant", Content: json.RawMessage(`"searching both"`), ToolCalls: []ChatToolCall{
				{ID: "call_a", Type: "function", Function: ChatFunctionCall{Name: "web_search", Arguments: `{"q":"A"}`}},
				{ID: "call_b", Type: "function", Function: ChatFunctionCall{Name: "web_search", Arguments: `{"q":"B"}`}},
			}},
			{Role: "tool", ToolCallID: "call_a", Content: json.RawMessage(`"result A"`)},
			// call_b's result is missing.
		},
	})
	for _, m := range msgs {
		require.Falsef(t, hasToolUse(parseContentBlocks(m.Content), "call_b"),
			"unanswered tool_use call_b should have been dropped")
	}
}

// Baseline: a well-formed multi-round tool history (text + tool_calls per
// assistant turn) converts and pairs correctly through the full chain.
func TestCCChain_WellFormedMultiRound(t *testing.T) {
	msgs := ccChainToAnthropic(t, &ChatCompletionsRequest{
		Model: "deepseek-v4-pro",
		Messages: []ChatMessage{
			{Role: "user", Content: json.RawMessage(`"do A then B"`)},
			{Role: "assistant", Content: json.RawMessage(`"running A"`), ToolCalls: []ChatToolCall{
				{ID: "call_a", Type: "function", Function: ChatFunctionCall{Name: "exec", Arguments: `{"cmd":"A"}`}},
			}},
			{Role: "tool", ToolCallID: "call_a", Content: json.RawMessage(`"A ok"`)},
			{Role: "assistant", Content: json.RawMessage(`"A done, running B"`), ToolCalls: []ChatToolCall{
				{ID: "call_b", Type: "function", Function: ChatFunctionCall{Name: "exec", Arguments: `{"cmd":"B"}`}},
			}},
			{Role: "tool", ToolCallID: "call_b", Content: json.RawMessage(`"B ok"`)},
			{Role: "assistant", Content: json.RawMessage(`"all done"`)},
		},
	})
	// Both calls survive and stay paired (assertAnthropicPairing already checks).
	var sawA, sawB bool
	for _, m := range msgs {
		blocks := parseContentBlocks(m.Content)
		sawA = sawA || hasToolUse(blocks, "call_a")
		sawB = sawB || hasToolUse(blocks, "call_b")
	}
	require.True(t, sawA && sawB, "both well-formed calls should be preserved")
}
