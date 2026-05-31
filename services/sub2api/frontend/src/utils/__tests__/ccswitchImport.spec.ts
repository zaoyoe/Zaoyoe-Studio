import { describe, expect, it } from 'vitest'
import {
  OPENAI_CC_SWITCH_CODEX_MODEL,
  buildCcSwitchImportDeeplink,
  resolveCcSwitchClaudeModelSlots
} from '@/utils/ccswitchImport'
import type { GroupPlatform } from '@/types'

function paramsFromDeeplink(deeplink: string): URLSearchParams {
  const query = deeplink.split('?')[1] || ''
  return new URLSearchParams(query)
}

describe('ccswitchImport utils', () => {
  const baseInput = {
    baseUrl: 'https://api.example.com',
    providerName: 'Sub2API',
    apiKey: 'sk-test',
    usageScript: 'return true'
  }

  it('adds the Codex model parameter for OpenAI imports', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'openai',
        clientType: 'claude'
      })
    )

    expect(params.get('resource')).toBe('provider')
    expect(params.get('app')).toBe('codex')
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.get('model')).toBe(OPENAI_CC_SWITCH_CODEX_MODEL)
    expect(atob(params.get('usageScript') || '')).toBe(baseInput.usageScript)
  })

  it.each([
    { platform: 'anthropic' as GroupPlatform, clientType: 'claude' as const, app: 'claude' },
    { platform: 'gemini' as GroupPlatform, clientType: 'gemini' as const, app: 'gemini' }
  ])('does not add a model parameter for $platform imports', ({ platform, clientType, app }) => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform,
        clientType
      })
    )

    expect(params.get('app')).toBe(app)
    expect(params.get('endpoint')).toBe(baseInput.baseUrl)
    expect(params.has('model')).toBe(false)
  })

  it('keeps Antigravity imports on the selected client endpoint without a model parameter', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'antigravity',
        clientType: 'gemini'
      })
    )

    expect(params.get('app')).toBe('gemini')
    expect(params.get('endpoint')).toBe(`${baseInput.baseUrl}/antigravity`)
    expect(params.has('model')).toBe(false)
  })

  it('adds Claude model slots when provided', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'anthropic',
        clientType: 'claude',
        claudeModelSlots: {
          haikuModel: 'claude-opus-4-8',
          sonnetModel: 'claude-opus-4-8',
          opusModel: 'claude-opus-4-8'
        }
      })
    )

    expect(params.get('app')).toBe('claude')
    expect(params.get('haikuModel')).toBe('claude-opus-4-8')
    expect(params.get('sonnetModel')).toBe('claude-opus-4-8')
    expect(params.get('opusModel')).toBe('claude-opus-4-8')
  })

  it('does not add Claude model slots to Codex imports', () => {
    const params = paramsFromDeeplink(
      buildCcSwitchImportDeeplink({
        ...baseInput,
        platform: 'openai',
        clientType: 'claude',
        claudeModelSlots: {
          haikuModel: 'claude-opus-4-8',
          sonnetModel: 'claude-opus-4-8',
          opusModel: 'claude-opus-4-8'
        }
      })
    )

    expect(params.get('app')).toBe('codex')
    expect(params.has('haikuModel')).toBe(false)
    expect(params.has('sonnetModel')).toBe(false)
    expect(params.has('opusModel')).toBe(false)
  })

  it('maps a single available Claude model to all CC Switch Claude slots', () => {
    expect(resolveCcSwitchClaudeModelSlots(['claude-opus-4-8'])).toEqual({
      haikuModel: 'claude-opus-4-8',
      sonnetModel: 'claude-opus-4-8',
      opusModel: 'claude-opus-4-8'
    })
  })

  it('prefers family-specific Claude models when they are available', () => {
    expect(
      resolveCcSwitchClaudeModelSlots([
        'claude-sonnet-4-5-20251001',
        'claude-opus-4-8',
        'claude-3-5-haiku-20241022'
      ])
    ).toEqual({
      haikuModel: 'claude-3-5-haiku-20241022',
      sonnetModel: 'claude-sonnet-4-5-20251001',
      opusModel: 'claude-opus-4-8'
    })
  })
})
