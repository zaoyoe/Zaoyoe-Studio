import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const componentPath = resolve(dirname(fileURLToPath(import.meta.url)), '../LoginView.vue')
const componentSource = readFileSync(componentPath, 'utf8')

describe('LoginView regional restriction entry points', () => {
  it('checks region before opening registration from the login footer', () => {
    expect(componentSource).toContain('getRegistrationRegionalRestrictionStatus')
    expect(componentSource).toContain('handleRegisterLinkClick')
    expect(componentSource).toContain('status.enabled && status.blocked')
    expect(componentSource).toContain("registrationRegionDialogMode.value = 'blocked'")
    expect(componentSource).toContain('showRegistrationRegionDialog.value = true')
    expect(componentSource).toMatch(/router\.push\(['"]\/register['"]\)/)
    expect(componentSource).not.toContain('to="/register"')
  })

  it('keeps the login form available and avoids adding a login region block', () => {
    const blockedLoginQuery = ['region_blocked', 'login'].join('=')
    const regionBlockedKey = ['login', 'Region', 'Blocked'].join('')
    const loginScopeConstant = ['regionalRestrictionScope', 'Login'].join('')

    expect(componentSource).toContain('@submit.prevent="handleLogin"')
    expect(componentSource).toContain('handle2FAVerify')
    expect(componentSource).not.toContain(blockedLoginQuery)
    expect(componentSource).not.toContain(regionBlockedKey)
    expect(componentSource).not.toContain("registrationRegionDialogMode.value = 'login_blocked'")
    expect(componentSource).not.toContain(loginScopeConstant)
  })

  it('does not fall through to registration when the region check fails', () => {
    expect(componentSource).toContain("registrationRegionDialogMode.value = 'check_failed'")
    expect(componentSource).toContain('registrationRegionCheckFailedTitle')
    expect(componentSource).toContain('registrationRegionCheckFailedDescription')
    expect(componentSource).toContain('registrationRegionCheckFailedReason')
    expect(componentSource).toMatch(
      /catch[\s\S]*showRegistrationRegionDialog\.value = true[\s\S]*return/
    )
  })
})
