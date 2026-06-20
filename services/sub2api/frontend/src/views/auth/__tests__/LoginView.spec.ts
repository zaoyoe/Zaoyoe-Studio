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
    expect(componentSource).toContain("openRegistrationRegionDialog('registration_blocked')")
    expect(componentSource).toContain('showRegistrationRegionDialog.value = true')
    expect(componentSource).toMatch(/router\.push\(['"]\/register['"]\)/)
    expect(componentSource).not.toContain('to="/register"')
  })

  it('does not region-check existing-account login or session completion', () => {
    expect(componentSource).toContain('@submit.prevent="handleLogin"')
    expect(componentSource).not.toContain('getLoginRegionalRestrictionStatus')
    expect(componentSource).not.toContain('handleLoginRegionPrecheck')
    expect(componentSource).not.toContain('if (await handleLoginRegionPrecheck())')
    expect(componentSource).not.toContain("region_blocked === 'login'")
    expect(componentSource).not.toContain('region_blocked=login')
    expect(componentSource).not.toContain("title: 'Login is not available in your region'")
    expect(componentSource).not.toContain('Father Key Core Keys account login is not available')
    expect(componentSource).not.toContain('Please access from a supported region')
    expect(componentSource).not.toContain("openRegistrationRegionDialog('login_blocked')")
    expect(componentSource).not.toContain("extractApiErrorCode(error) === 'REGION_RESTRICTED'")
    expect(componentSource).toContain('handle2FAVerify')
  })

  it('does not fall through to registration when the region check fails', () => {
    expect(componentSource).toContain("openRegistrationRegionDialog('check_failed')")
    expect(componentSource).toContain("title: 'Unable to confirm registration region'")
    expect(componentSource).toContain('The system could not confirm your current request region')
    expect(componentSource).toContain('registration requires a region availability check first')
    expect(componentSource).toMatch(
      /catch[\s\S]*openRegistrationRegionDialog\('check_failed'\)[\s\S]*return/
    )
  })

  it('defaults the regional restriction dialog to English without changing the page locale', () => {
    expect(componentSource).toContain("const registrationRegionDialogLanguage = ref<'en' | 'zh'>('en')")
    expect(componentSource).toContain("registrationRegionDialogLanguage.value = 'en'")
    expect(componentSource).toContain("title: 'Registration is not available in your region'")
    expect(componentSource).toContain("confirm: 'Confirm'")
    expect(componentSource).toContain('toggleRegionalRestrictionDialogLanguage')
    expect(componentSource).not.toContain("setLocale(String(locale.value).startsWith('zh') ? 'en' : 'zh')")
  })
})
