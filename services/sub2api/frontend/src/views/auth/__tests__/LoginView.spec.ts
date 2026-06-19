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
    expect(componentSource).toContain("registrationRegionDialogMode.value = 'registration_blocked'")
    expect(componentSource).toContain('showRegistrationRegionDialog.value = true')
    expect(componentSource).toMatch(/router\.push\(['"]\/register['"]\)/)
    expect(componentSource).not.toContain('to="/register"')
  })

  it('checks region before issuing login tokens while keeping the login page reachable', () => {
    expect(componentSource).toContain('@submit.prevent="handleLogin"')
    expect(componentSource).toContain('getLoginRegionalRestrictionStatus')
    expect(componentSource).toContain('handleLoginRegionPrecheck')
    expect(componentSource).toContain('if (await handleLoginRegionPrecheck())')
    expect(componentSource).toContain('region_blocked')
    expect(componentSource).toContain('loginRegionBlockedTitle')
    expect(componentSource).toContain('loginRegionBlockedDescription')
    expect(componentSource).toContain('loginRegionBlockedReason')
    expect(componentSource).toContain("registrationRegionDialogMode.value = 'login_blocked'")
    expect(componentSource).toContain("extractApiErrorCode(error) === 'REGION_RESTRICTED'")
    expect(componentSource).toContain('handle2FAVerify')
    expect(componentSource).toContain('show2FAModal.value = false')
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
