/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { after, afterEach, describe, test } from 'node:test'

import { Window } from 'happy-dom'

const domWindow = new Window({ url: 'https://example.test/keys' })
const domGlobals = [
  'window',
  'document',
  'navigator',
  'history',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLLabelElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'KeyboardEvent',
  'PointerEvent',
  'MouseEvent',
  'FocusEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { RegionalRestrictionGate } = await import('../regional-restriction-gate')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type RegionalResponse = {
  enabled: boolean
  confirmation_required: boolean
  blocked: boolean
  country_code: string
  unknown_region: boolean
  revision: string
  confirmation_frequency: string
  confirmation_interval_hours: number
  message?: string
}

type ApiGet = (
  url: string,
  config?: { params?: { scope?: string } }
) => Promise<{ data: unknown }>
type ApiPost = (
  url: string,
  data?: unknown,
  config?: Record<string, unknown>
) => Promise<{ data: unknown }>
type MockableApi = { get: ApiGet; post: ApiPost }
type ApiKeyCreationAuthorization = {
  allowed: boolean
  securityProof?: string
}
type RenderedGate = {
  host: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post
let renderedGate: RenderedGate | null = null

const allowedStatus: RegionalResponse = {
  enabled: true,
  confirmation_required: false,
  blocked: false,
  country_code: 'US',
  unknown_region: false,
  revision: '2026-06-17',
  confirmation_frequency: 'once_per_revision',
  confirmation_interval_hours: 24,
}

function apiResponse(status: RegionalResponse) {
  return {
    data: {
      success: true,
      message: '',
      data: status,
    },
  }
}

async function waitForCondition(
  condition: () => boolean,
  failureMessage: string
): Promise<void> {
  if (condition()) return

  await new Promise<void>((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!condition()) return
      clearTimeout(timeoutId)
      observer.disconnect()
      resolve()
    })
    const timeoutId = setTimeout(() => {
      observer.disconnect()
      reject(new Error(`${failureMessage}: ${document.body.textContent}`))
    }, 1500)

    observer.observe(document, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    })
  })
}

function findButton(text: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.trim() === text
    ) ?? null
  )
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      domWindow.HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(valueSetter)
    valueSetter.call(input, value)
    input.dispatchEvent(
      new domWindow.Event('input', { bubbles: true }) as unknown as Event
    )
  })
}

async function renderGate(
  onCreateAllowed = (_authorization: ApiKeyCreationAuthorization) => undefined
): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  renderedGate = { host, root }

  await act(async () =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <RegionalRestrictionGate>
          {({ checkApiKeyCreation }) => (
            <div data-testid='key-management'>
              <button
                type='button'
                onClick={() => {
                  void checkApiKeyCreation().then((authorization) => {
                    if (authorization.allowed) onCreateAllowed(authorization)
                  })
                }}
              >
                Attempt protected creation
              </button>
            </div>
          )}
        </RegionalRestrictionGate>
      </I18nextProvider>
    )
  )
}

afterEach(async () => {
  if (renderedGate) {
    await act(async () => renderedGate?.root.unmount())
    renderedGate.host.remove()
    renderedGate = null
  }
  document.body.replaceChildren()
  window.localStorage.clear()
  apiClient.get = originalGet
  apiClient.post = originalPost
  await i18n.changeLanguage('en')
})

after(() => {
  apiClient.get = originalGet
  apiClient.post = originalPost
  domWindow.close()
})

describe('API key regional restriction gate', () => {
  test('keeps the complete original English contract and loads management only after confirmation', async () => {
    let creationAuthorization: ApiKeyCreationAuthorization | null = null
    const verificationRequests: Array<{
      url: string
      data: unknown
      config: Record<string, unknown> | undefined
    }> = []
    apiClient.get = async () =>
      apiResponse({
        ...allowedStatus,
        confirmation_required: true,
      })
    apiClient.post = async (url, data, config) => {
      verificationRequests.push({ url, data, config })
      return {
        data: {
          success: true,
          data: {
            proof_token: 'password-proof',
            expires_at: Math.floor(Date.now() / 1000) + 300,
            method: 'password',
            scope: 'api_key.create',
          },
        },
      }
    }
    await i18n.changeLanguage('zh')

    await renderGate((authorization) => {
      creationAuthorization = authorization
    })
    await waitForCondition(
      () =>
        document.body.textContent?.includes('API Key Use Confirmation') ===
        true,
      'Confirmation dialog did not open'
    )

    const bodyText = document.body.textContent || ''
    for (const expectedCopy of [
      'API Key Use Confirmation',
      'Before creating or managing API keys, please confirm that you will not use this service from a restricted region or for prohibited, abusive, or unlawful activity.',
      'The service is not offered to users located in restricted regions, including mainland China.',
      'You must not evade regional, payment, provider, or legal restrictions.',
      'You must comply with the Terms, Privacy Policy, Acceptable Use Policy, Refund and Suspension Policy, and Restricted Regions Notice.',
      'Account password',
      'Enter the password for the currently signed-in account to continue.',
      'Your password is verified securely by the server and is never stored in this browser.',
    ]) {
      assert.ok(
        bodyText.includes(expectedCopy),
        `Missing copy: ${expectedCopy}`
      )
    }
    assert.equal(bodyText.includes('API 密钥使用确认'), false)

    const expectedLinks = new Map([
      ['Terms', '/user-agreement'],
      ['Privacy', '/privacy-policy'],
      ['Acceptable Use', '/user-agreement'],
      ['Refund', 'https://www.fatherkey.com/refund-policy'],
      ['Restricted Regions', '/user-agreement'],
    ])
    for (const [label, href] of expectedLinks) {
      const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
        (candidate) => candidate.textContent?.trim() === label
      )
      assert.ok(link, `Missing legal link: ${label}`)
      assert.equal(link.getAttribute('href'), href)
      assert.equal(link.target, '_blank')
      assert.equal(link.rel, 'noopener noreferrer')
    }
    assert.equal(document.querySelector('[data-testid="key-management"]'), null)

    assert.equal(document.querySelector('[role="checkbox"]'), null)
    const passwordInput = document.querySelector<HTMLInputElement>(
      '#regional-restriction-password'
    )
    assert.ok(passwordInput)
    assert.equal(passwordInput.type, 'password')
    assert.equal(passwordInput.autocomplete, 'current-password')
    const confirmButton = findButton('Verify and Continue')
    assert.ok(confirmButton)
    assert.equal(confirmButton.disabled, true)

    await changeInput(passwordInput, 'Correct Password 123')
    assert.equal(confirmButton.disabled, false)
    await act(async () => confirmButton.click())

    await waitForCondition(
      () => document.querySelector('[data-testid="key-management"]') !== null,
      'API key management did not load after confirmation'
    )
    assert.deepEqual(verificationRequests, [
      {
        url: '/api/verify',
        data: {
          method: 'password',
          password: 'Correct Password 123',
          scope: 'api_key.create',
        },
        config: {
          skipBusinessError: true,
          skipErrorHandler: true,
          disableDuplicate: true,
        },
      },
    ])

    const createButton = findButton('Attempt protected creation')
    assert.ok(createButton)
    await act(async () => createButton.click())
    await waitForCondition(
      () => creationAuthorization !== null,
      'Password proof was not authorized for API key creation'
    )
    assert.deepEqual(creationAuthorization, {
      allowed: true,
      securityProof: 'password-proof',
    })
  })

  test('keeps the confirmation dialog closed to management after an incorrect password', async () => {
    apiClient.get = async () =>
      apiResponse({
        ...allowedStatus,
        confirmation_required: true,
      })
    apiClient.post = async () => ({
      data: {
        success: false,
        message: 'Incorrect account password',
      },
    })

    await renderGate()
    await waitForCondition(
      () => findButton('Verify and Continue') !== null,
      'Confirmation dialog did not open'
    )
    const passwordInput = document.querySelector<HTMLInputElement>(
      '#regional-restriction-password'
    )
    assert.ok(passwordInput)
    await changeInput(passwordInput, 'wrong password')
    const confirmButton = findButton('Verify and Continue')
    assert.ok(confirmButton)
    await act(async () => confirmButton.click())
    await waitForCondition(
      () =>
        document.body.textContent?.includes('Incorrect account password') ===
        true,
      'Incorrect-password error was not shown'
    )

    assert.equal(document.querySelector('[data-testid="key-management"]'), null)
    assert.equal(passwordInput.getAttribute('aria-invalid'), 'true')
  })

  test('switches explicitly between the default English copy and Chinese translation', async () => {
    apiClient.get = async () =>
      apiResponse({
        ...allowedStatus,
        confirmation_required: true,
      })

    await renderGate()
    await waitForCondition(
      () =>
        document.body.textContent?.includes('API Key Use Confirmation') ===
        true,
      'English confirmation dialog did not open'
    )

    const showChineseButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Show Chinese translation"]'
    )
    assert.ok(showChineseButton)
    assert.equal(showChineseButton.getAttribute('aria-pressed'), 'false')

    await act(async () => showChineseButton.click())
    assert.ok(document.body.textContent?.includes('API 密钥使用确认'))
    assert.ok(
      document.body.textContent?.includes(
        '你不得规避地区、支付、服务提供方或法律限制。'
      )
    )
    assert.equal(
      document.body.textContent?.includes('API Key Use Confirmation'),
      false
    )

    const showEnglishButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="显示英文原文"]'
    )
    assert.ok(showEnglishButton)
    assert.equal(showEnglishButton.getAttribute('aria-pressed'), 'true')
    await act(async () => showEnglishButton.click())
    assert.ok(document.body.textContent?.includes('API Key Use Confirmation'))
  })

  test('does not render API key management when the current region is blocked', async () => {
    apiClient.get = async () =>
      apiResponse({
        ...allowedStatus,
        blocked: true,
        country_code: 'CN',
        message:
          'The service is not offered to users located in restricted regions, including mainland China.',
      })

    await renderGate()
    await waitForCondition(
      () =>
        document.body.textContent?.includes(
          'This request is from a restricted region, so API key creation and management are not available.'
        ) === true,
      'Blocked dialog did not open'
    )

    assert.equal(document.querySelector('[data-testid="key-management"]'), null)
    assert.equal(findButton('Verify and Continue'), null)
    assert.equal(document.querySelector('#regional-restriction-password'), null)
  })

  test('checks api_key_create and prevents the protected creation action when blocked', async () => {
    const scopes: string[] = []
    let createAllowedCount = 0
    apiClient.get = async (_url, config) => {
      const scope = config?.params?.scope || ''
      scopes.push(scope)
      if (scope === 'api_key_create') {
        return apiResponse({
          ...allowedStatus,
          blocked: true,
          country_code: 'CN',
        })
      }
      return apiResponse(allowedStatus)
    }

    await renderGate(() => {
      createAllowedCount += 1
    })
    await waitForCondition(
      () => document.querySelector('[data-testid="key-management"]') !== null,
      'API key management did not load'
    )

    const createButton = findButton('Attempt protected creation')
    assert.ok(createButton)
    await act(async () => createButton.click())
    await waitForCondition(
      () =>
        document.body.textContent?.includes(
          'This request is from a restricted region, so API key creation and management are not available.'
        ) === true,
      'Blocked create attempt did not open the restriction dialog'
    )

    assert.deepEqual(scopes, ['api_key_page', 'api_key_create'])
    assert.equal(createAllowedCount, 0)
    assert.equal(document.querySelector('[data-testid="key-management"]'), null)
  })
})
