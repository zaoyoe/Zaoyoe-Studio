import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('KeysView regional restriction confirmation modal', () => {
  const componentSource = fs.readFileSync(path.resolve(__dirname, '../KeysView.vue'), 'utf8')

  it('keeps the original English confirmation copy and restricted-regions notice', () => {
    expect(componentSource).toContain("title: 'API Key Use Confirmation'")
    expect(componentSource).toContain(
      'The service is not offered to users located in restricted regions, including mainland China.'
    )
  })

  it('checks both page access and API key creation without a site-wide gate', () => {
    expect(componentSource).toContain("openRegionalRestrictionModal('api_key_create')")
    expect(componentSource).toContain("scope: RegionalRestrictionScope = 'api_key_page'")
    expect(componentSource).toContain('openRegionalRestrictionModal()')
    expect(componentSource).not.toContain('router.beforeEach')
  })

  it('defaults to English and preserves configurable confirmation frequency', () => {
    expect(componentSource).toContain("regionalRestrictionTranslationMode = ref<'en' | 'zh'>('en')")
    expect(componentSource).toContain('regionalRestrictionConfirmationFrequency')
    expect(componentSource).toContain('regionalRestrictionConfirmationIntervalHours')
  })
})
