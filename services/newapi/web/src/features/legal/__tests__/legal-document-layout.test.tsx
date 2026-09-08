import assert from 'node:assert/strict'
import { after, afterEach, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window({ url: 'https://example.test/legal/terms' })
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'MutationObserver',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { LegalDocumentArticle } = await import('../legal-document')
const { getVisibleLegalDocuments } = await import('../documents')

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
})

after(() => {
  domWindow.close()
  for (const key of domGlobals) {
    Reflect.deleteProperty(globalThis, key)
  }
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

describe('legal document layout', () => {
  test('filters navigation links using the API key legal visibility settings', () => {
    assert.deepEqual(
      getVisibleLegalDocuments(undefined).map((document) => document.id),
      ['terms', 'privacy', 'acceptable-use', 'refund', 'restricted-regions']
    )

    assert.deepEqual(
      getVisibleLegalDocuments({ api_key_refund_enabled: false }).map(
        (document) => document.id
      ),
      ['terms', 'privacy', 'acceptable-use', 'restricted-regions']
    )

    assert.deepEqual(
      getVisibleLegalDocuments({
        api_key_terms_enabled: false,
        api_key_privacy_enabled: true,
        api_key_acceptable_use_enabled: false,
        api_key_refund_enabled: false,
        api_key_restricted_regions_enabled: true,
      }).map((document) => document.id),
      ['privacy', 'restricted-regions']
    )

    assert.deepEqual(
      getVisibleLegalDocuments({
        api_key_terms_enabled: false,
        api_key_privacy_enabled: false,
        api_key_acceptable_use_enabled: false,
        api_key_refund_enabled: false,
        api_key_restricted_regions_enabled: false,
      }),
      []
    )
  })

  test('preserves source line breaks inside a semantic article', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <LegalDocumentArticle
          title='Terms of Service'
          content={
            'Version: 2026-08-05\nEffective: 2026-08-05\n\n1. Definitions\nDefinition body'
          }
          contentIsHtml={false}
        />
      )
    })

    const article = container.querySelector('article')
    assert.ok(article)
    assert.equal(article.querySelector('h1')?.textContent, 'Terms of Service')
    assert.ok(
      article.querySelectorAll('br').length >= 2,
      'single source line breaks should remain visible'
    )

    await act(async () => root.unmount())
  })
})
