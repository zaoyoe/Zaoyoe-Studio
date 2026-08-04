import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import i18next from 'i18next'

import { api } from '../http-client'

await i18next.init({
  lng: 'en',
  resources: { en: { translation: {} }, zhCN: { translation: {} } },
})

afterEach(async () => {
  await i18next.changeLanguage('en')
})

describe('HTTP request language header', () => {
  test('sends the selected Chinese interface language to the backend', async () => {
    await i18next.changeLanguage('zhCN')
    let languageHeader = ''

    await api.get('/language-contract', {
      skipBusinessError: true,
      adapter: async (config) => {
        languageHeader = String(config.headers.get('Accept-Language') || '')
        return {
          data: { success: true },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      },
    })

    assert.equal(languageHeader, 'zh-CN')
  })

  test('uses English for the English interface', async () => {
    await i18next.changeLanguage('en')
    let languageHeader = ''

    await api.get('/language-contract', {
      skipBusinessError: true,
      adapter: async (config) => {
        languageHeader = String(config.headers.get('Accept-Language') || '')
        return {
          data: { success: true },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      },
    })

    assert.equal(languageHeader, 'en')
  })
})
