import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { toBackendLanguage } from '../languages'

describe('backend request language', () => {
  test('maps the NewAPI Chinese interface environments to backend locales', () => {
    assert.equal(toBackendLanguage('zhCN'), 'zh-CN')
    assert.equal(toBackendLanguage('zhTW'), 'zh-TW')
  })

  test('uses English for English and unsupported backend locales', () => {
    assert.equal(toBackendLanguage('en'), 'en')
    assert.equal(toBackendLanguage('fr'), 'en')
    assert.equal(toBackendLanguage(), 'en')
  })
})
