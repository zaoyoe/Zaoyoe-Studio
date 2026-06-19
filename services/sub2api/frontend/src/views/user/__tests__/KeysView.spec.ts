import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const componentPath = resolve(dirname(fileURLToPath(import.meta.url)), '../KeysView.vue')
const componentSource = readFileSync(componentPath, 'utf8')

describe('KeysView regional restriction confirmation modal', () => {
  it('keeps the original English copy and exposes a Chinese translation toggle', () => {
    expect(componentSource).toContain("title: 'API Key Use Confirmation'")
    expect(componentSource).toContain('Before creating or managing API keys')
    expect(componentSource).toContain("title: 'API 密钥使用确认'")
    expect(componentSource).toContain('toggleRegionalRestrictionTranslation')
    expect(componentSource).toContain("regionalRestrictionTranslationMode.value === 'en' ? 'zh' : 'en'")
    expect(componentSource).toContain("regionalRestrictionTranslationMode = ref<'en' | 'zh'>('en')")
    expect(componentSource).toContain('translateAriaLabel')
    expect(componentSource).not.toContain('translateButton')
  })

  it('supports configurable prompt frequency without changing the default behavior', () => {
    expect(componentSource).toContain("regionalRestrictionConfirmationFrequency")
    expect(componentSource).toContain("'once_per_revision'")
    expect(componentSource).toContain("regionalRestrictionConfirmationIntervalHours")
    expect(componentSource).toContain("regionalRestrictionAcceptedThisVisit")
    expect(componentSource).toContain("elapsedHours < regionalRestrictionConfirmationIntervalHours.value")
  })

  it('keeps the dialog content left aligned without a leading warning icon', () => {
    expect(componentSource).toContain('regionalRestrictionModalCopy.translateAriaLabel')
    expect(componentSource).not.toContain("regionalRestrictionBlocked ? 'exclamationCircle' : 'globe'")
    expect(componentSource).not.toContain('regionalRestrictionModalCopy.translateButton')
    expect(componentSource).not.toContain('py-5 pr-14')
    expect(componentSource).not.toContain('sm:py-6 sm:pr-16')
  })
})
