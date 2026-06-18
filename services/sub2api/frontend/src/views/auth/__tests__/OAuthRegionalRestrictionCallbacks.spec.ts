import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const authViewsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const callbackFiles = [
  'OAuthCallbackView.vue',
  'LinuxDoCallbackView.vue',
  'OidcCallbackView.vue',
  'DingTalkCallbackView.vue',
  'WechatCallbackView.vue'
] as const

function readCallbackSource(file: (typeof callbackFiles)[number]): string {
  return readFileSync(resolve(authViewsDir, file), 'utf8')
}

describe('OAuth callback regional restriction handling', () => {
  it.each(callbackFiles)('%s routes registration regional restrictions to the login dialog', (file) => {
    const source = readCallbackSource(file)
    const blockedLoginQuery = ['region_blocked', 'login'].join('=')

    expect(source).toContain('regionalRestrictionRegistrationPath')
    expect(source).toContain('isRegistrationRegionalRestrictionFragment')
    expect(source).toContain('router.replace(regionalRestrictionRegistrationPath())')
    expect(source).not.toContain(blockedLoginQuery)
  })

  it.each([
    'LinuxDoCallbackView.vue',
    'OidcCallbackView.vue',
    'DingTalkCallbackView.vue',
    'WechatCallbackView.vue'
  ] as const)('%s clears pending sessions before redirecting restricted new signups', (file) => {
    const source = readCallbackSource(file)

    expect(source).toContain('redirectRegistrationRegionalRestrictionError')
    expect(source).toContain('isRegistrationRegionalRestrictionApiError')
    expect(source).toContain('clearPendingAuthSession()')
  })
})
