// Package openai provides helpers and types for OpenAI API integration.
package openai

import (
	_ "embed"
	"strings"
)

const codexGPT51IdentityLine = "You are GPT-5.1 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful."
const codexGPT52IdentityLine = "You are GPT-5.2 running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful."

// Model represents an OpenAI model
type Model struct {
	ID          string `json:"id"`
	Object      string `json:"object"`
	Created     int64  `json:"created"`
	OwnedBy     string `json:"owned_by"`
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
}

// DefaultModels OpenAI models list
var DefaultModels = []Model{
	{ID: "gpt-5.5", Object: "model", Created: 1776873600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.5"},
	{ID: "gpt-5.4", Object: "model", Created: 1738368000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.4"},
	{ID: "gpt-5.4-mini", Object: "model", Created: 1738368000, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.4 Mini"},
	{ID: "gpt-5.3-codex", Object: "model", Created: 1735689600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.3 Codex"},
	{ID: "gpt-5.3-codex-spark", Object: "model", Created: 1735689600, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.3 Codex Spark"},
	{ID: "codex-auto-review", Object: "model", Created: 1776902400, OwnedBy: "openai", Type: "model", DisplayName: "Codex Auto Review"},
	{ID: "gpt-5.2", Object: "model", Created: 1733875200, OwnedBy: "openai", Type: "model", DisplayName: "GPT-5.2"},
	{ID: "gpt-image-1", Object: "model", Created: 1733875200, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 1"},
	{ID: "gpt-image-1.5", Object: "model", Created: 1735689600, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 1.5"},
	{ID: "gpt-image-2", Object: "model", Created: 1738368000, OwnedBy: "openai", Type: "model", DisplayName: "GPT Image 2"},
}

// DefaultModelIDs returns the default model ID list
func DefaultModelIDs() []string {
	ids := make([]string, len(DefaultModels))
	for i, m := range DefaultModels {
		ids[i] = m.ID
	}
	return ids
}

// DefaultTestModel default model for testing OpenAI accounts
const DefaultTestModel = "gpt-5.4"

// DefaultInstructions default instructions for non-Codex CLI requests.
// 内容为真实 Codex CLI 的 GPT-5-Codex base prompt（codex 系模型默认）。
//
//go:embed instructions.txt
var DefaultInstructions string

// instructionsGPT51 / instructionsGPT52 为 gpt-5.1 / gpt-5.2 非 codex 模型对应的
// 真实 Codex 编码 agent base prompt，用于模型感知的 instructions 选择。
//
//go:embed instructions_gpt5_1.txt
var instructionsGPT51 string

//go:embed instructions_gpt5_2.txt
var instructionsGPT52 string

// CodexBaseInstructionsForModel 按模型返回最匹配的真实 Codex base instructions。
// 非 codex 的 gpt-5.x 模型会保留相近版本的行为提示，但第一句身份必须使用
// 实际请求模型，避免把 gpt-5.4/gpt-5.5 等虚报为 GPT-5.1。
//
// 任一专用 prompt 意外为空时回退到 DefaultInstructions，保证返回非空。
func CodexBaseInstructionsForModel(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	switch {
	case strings.Contains(m, "codex"):
		return DefaultInstructions
	case strings.HasPrefix(m, "gpt-5.2"):
		if v := strings.TrimSpace(instructionsGPT52); v != "" {
			return withActualGPTModelIdentity(instructionsGPT52, model, codexGPT52IdentityLine)
		}
	case strings.HasPrefix(m, "gpt-5.1"), strings.HasPrefix(m, "gpt-5"):
		if v := strings.TrimSpace(instructionsGPT51); v != "" {
			return withActualGPTModelIdentity(instructionsGPT51, model, codexGPT51IdentityLine)
		}
	}
	return DefaultInstructions
}

func withActualGPTModelIdentity(instructions, model, oldIdentityLine string) string {
	actual := gptModelDisplayName(model)
	if actual == "" {
		return instructions
	}
	newIdentityLine := "You are " + actual + " running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful."
	if strings.HasPrefix(instructions, oldIdentityLine) {
		return newIdentityLine + strings.TrimPrefix(instructions, oldIdentityLine)
	}
	lines := strings.SplitN(instructions, "\n", 2)
	if len(lines) == 2 && strings.HasPrefix(strings.TrimSpace(lines[0]), "You are GPT-") {
		return newIdentityLine + "\n" + lines[1]
	}
	return instructions
}

func gptModelDisplayName(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return ""
	}
	if strings.Contains(m, "/") {
		parts := strings.Split(m, "/")
		m = parts[len(parts)-1]
	}
	m = strings.TrimSuffix(m, "-openai-compact")
	if !strings.HasPrefix(m, "gpt-") {
		return ""
	}
	parts := strings.Split(m, "-")
	if len(parts) < 2 {
		return ""
	}
	version := parts[1]
	if version == "" {
		return ""
	}
	nameParts := []string{"GPT-" + version}
	for _, part := range parts[2:] {
		if part == "" {
			continue
		}
		if part == "codex" {
			return ""
		}
		nameParts = append(nameParts, strings.ToUpper(part[:1])+part[1:])
	}
	return strings.Join(nameParts, " ")
}
