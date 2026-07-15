import type { GroupPlatform } from '@/types'

export const OPENAI_CC_SWITCH_CODEX_MODEL = 'gpt-5.5'

export type CcSwitchClientType = 'claude' | 'gemini'

export interface CcSwitchImportConfig {
  app: string
  endpoint: string
  model?: string
}

export interface CcSwitchClaudeModelSlots {
  fableModel?: string
  haikuModel?: string
  sonnetModel?: string
  opusModel?: string
}

export interface CcSwitchImportDeeplinkInput {
  baseUrl: string
  platform?: GroupPlatform | null
  clientType: CcSwitchClientType
  providerName: string
  apiKey: string
  usageScript: string
  claudeModelSlots?: CcSwitchClaudeModelSlots
}

export function resolveCcSwitchImportConfig(
  platform: GroupPlatform | undefined | null,
  clientType: CcSwitchClientType,
  baseUrl: string
): CcSwitchImportConfig {
  switch (platform || 'anthropic') {
    case 'antigravity':
      return {
        app: clientType === 'gemini' ? 'gemini' : 'claude',
        endpoint: `${baseUrl}/antigravity`
      }
    case 'openai':
      return {
        app: 'codex',
        endpoint: baseUrl,
        model: OPENAI_CC_SWITCH_CODEX_MODEL
      }
    case 'gemini':
      return {
        app: 'gemini',
        endpoint: baseUrl
      }
    default:
      return {
        app: 'claude',
        endpoint: baseUrl
      }
  }
}

export function buildCcSwitchImportDeeplink(input: CcSwitchImportDeeplinkInput): string {
  const config = resolveCcSwitchImportConfig(input.platform, input.clientType, input.baseUrl)
  const entries: [string, string][] = [
    ['resource', 'provider'],
    ['app', config.app],
    ['name', input.providerName],
    ['homepage', input.baseUrl],
    ['endpoint', config.endpoint],
    ['apiKey', input.apiKey],
    ['configFormat', 'json'],
    ['usageEnabled', 'true'],
    ['usageScript', btoa(input.usageScript)],
    ['usageAutoInterval', '30']
  ]

  if (config.model) {
    entries.splice(2, 0, ['model', config.model])
  }

  if (config.app === 'claude' && input.claudeModelSlots) {
    const { fableModel, haikuModel, sonnetModel, opusModel } = input.claudeModelSlots
    if (fableModel) entries.push(['fableModel', fableModel])
    if (haikuModel) entries.push(['haikuModel', haikuModel])
    if (sonnetModel) entries.push(['sonnetModel', sonnetModel])
    if (opusModel) entries.push(['opusModel', opusModel])
  }

  return `ccswitch://v1/import?${new URLSearchParams(entries).toString()}`
}

export function resolveCcSwitchClaudeModelSlots(
  modelIds: readonly string[]
): CcSwitchClaudeModelSlots | undefined {
  const models = Array.from(
    new Set(modelIds.map((model) => model.trim()).filter((model) => model.length > 0))
  )

  if (models.length === 0) return undefined

  const findByFamily = (family: string) =>
    models.find((model) => model.toLowerCase().includes(family))

  const fableModel = findByFamily('fable')
  const opusModel = findByFamily('opus') || models[0]
  const sonnetModel = findByFamily('sonnet') || opusModel || models[0]
  const haikuModel = findByFamily('haiku') || sonnetModel || opusModel || models[0]

  return {
    fableModel,
    haikuModel,
    sonnetModel,
    opusModel
  }
}
