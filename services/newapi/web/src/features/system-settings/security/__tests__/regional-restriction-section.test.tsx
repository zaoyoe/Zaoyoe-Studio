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

const domWindow = new Window({ url: 'https://example.test/settings' })
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLFormElement',
  'HTMLInputElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
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
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { api } = await import('@/lib/api')
const { SettingsPageProvider } =
  await import('../../components/settings-page-context')
const { RegionalRestrictionSection } =
  await import('../regional-restriction-section')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type ApiPut = (
  url: string,
  data?: unknown,
  config?: unknown
) => Promise<{ data: { success: boolean; message: string } }>
type MockableApi = { put: ApiPut }
type RenderedSection = {
  host: HTMLDivElement
  actions: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

const apiClient = api as unknown as MockableApi
const originalPut = apiClient.put
let renderedSection: RenderedSection | null = null

const defaultValues = {
  'regional_restriction.enabled': true,
  'regional_restriction.login_enabled': true,
  'regional_restriction.registration_enabled': true,
  'regional_restriction.oauth_signup_enabled': true,
  'regional_restriction.api_key_page_confirmation_enabled': true,
  'regional_restriction.api_key_create_enabled': true,
  'regional_restriction.blocked_country_codes': ['CN'],
  'regional_restriction.unknown_region_policy': 'allow' as const,
  'regional_restriction.confirmation_revision': '2026-06-17',
  'regional_restriction.confirmation_frequency': 'once_per_revision' as const,
  'regional_restriction.confirmation_interval_hours': 24,
}

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    domWindow.HTMLInputElement.prototype,
    'value'
  )?.set
  assert.ok(valueSetter)
  valueSetter.call(input, value)
  input.dispatchEvent(
    new domWindow.Event('input', { bubbles: true }) as unknown as Event
  )
}

async function renderSection(): Promise<void> {
  const host = document.createElement('div')
  const actions = document.createElement('div')
  document.body.append(host, actions)
  const root = createRoot(host)
  renderedSection = { host, actions, root }

  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <I18nextProvider i18n={i18n}>
          <SettingsPageProvider
            actionsContainer={actions}
            suppressSectionHeader={false}
          >
            <RegionalRestrictionSection defaultValues={defaultValues} />
          </SettingsPageProvider>
        </I18nextProvider>
      </QueryClientProvider>
    )
  )
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

afterEach(async () => {
  if (renderedSection) {
    await act(async () => renderedSection?.root.unmount())
    renderedSection.host.remove()
    renderedSection.actions.remove()
    renderedSection = null
  }
  document.body.replaceChildren()
  apiClient.put = originalPut
})

after(() => {
  apiClient.put = originalPut
  domWindow.close()
})

describe('regional restriction settings', () => {
  test('persists the new-login-session restriction independently', async () => {
    const requests: Array<{ key?: string; value?: unknown }> = []
    apiClient.put = async (_url, data) => {
      requests.push((data || {}) as { key?: string; value?: unknown })
      return { data: { success: true, message: '' } }
    }

    await renderSection()

    const loginLabel = [...document.querySelectorAll('label')].find(
      (label) => label.textContent?.trim() === 'New login sessions'
    )
    assert.ok(loginLabel)
    const loginControl = document.querySelector<HTMLInputElement>(
      `#${loginLabel.htmlFor}`
    )
    assert.ok(loginControl)
    assert.equal(loginControl.type, 'checkbox')
    assert.equal(loginControl.checked, true)
    const loginSwitch =
      loginControl.parentElement?.querySelector<HTMLElement>('[role="switch"]')
    assert.ok(loginSwitch)
    assert.equal(loginSwitch.getAttribute('aria-checked'), 'true')
    assert.ok(
      [...document.querySelectorAll('label')].some(
        (label) => label.textContent?.trim() === 'API key password confirmation'
      )
    )
    assert.ok(
      document.body.textContent?.includes(
        'Require the current account password before API key management is loaded and API keys can be created.'
      )
    )
    assert.equal(
      document.body.textContent?.includes('Confirmation revision'),
      false
    )
    assert.equal(
      document.body.textContent?.includes('Confirmation frequency'),
      false
    )

    await act(async () => loginSwitch.click())
    assert.equal(loginControl.checked, false)
    assert.equal(loginSwitch.getAttribute('aria-checked'), 'false')

    const saveButton = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (button) =>
        button.textContent?.trim() === 'Save regional restriction settings'
    )
    assert.ok(saveButton)

    await act(async () => saveButton.click())
    await flushAsyncWork()

    assert.deepEqual(requests, [
      { key: 'regional_restriction.login_enabled', value: false },
    ])
  })

  test('stops on a business failure, retries unsaved changes, and advances the baseline only after success', async () => {
    const requests: Array<{ key?: string; value?: unknown }> = []
    apiClient.put = async (_url, data) => {
      requests.push((data || {}) as { key?: string; value?: unknown })
      if (requests.length === 1) {
        return { data: { success: false, message: 'regional save failed' } }
      }
      return { data: { success: true, message: '' } }
    }

    await renderSection()

    const countryCodesLabel = [...document.querySelectorAll('label')].find(
      (label) => label.textContent?.trim() === 'Blocked country codes'
    )
    assert.ok(countryCodesLabel)
    const countryCodesInput = document.querySelector<HTMLInputElement>(
      `#${countryCodesLabel.htmlFor}`
    )
    assert.ok(countryCodesInput)

    const registrationLabel = [...document.querySelectorAll('label')].find(
      (label) => label.textContent?.trim() === 'Password registration'
    )
    assert.ok(registrationLabel)
    const registrationInput = document.querySelector<HTMLInputElement>(
      `#${registrationLabel.htmlFor}`
    )
    assert.ok(registrationInput)
    const registrationSwitch =
      registrationInput.parentElement?.querySelector<HTMLElement>(
        '[role="switch"]'
      )
    assert.ok(registrationSwitch)

    await act(async () => {
      changeInputValue(countryCodesInput, 'CN, US')
      registrationSwitch.click()
    })

    const saveButton = [
      ...document.querySelectorAll<HTMLButtonElement>('button'),
    ].find(
      (button) =>
        button.textContent?.trim() === 'Save regional restriction settings'
    )
    assert.ok(saveButton)

    await act(async () => saveButton.click())
    await flushAsyncWork()
    assert.deepEqual(requests, [
      {
        key: 'regional_restriction.registration_enabled',
        value: false,
      },
    ])

    await act(async () => saveButton.click())
    await flushAsyncWork()
    assert.deepEqual(requests, [
      {
        key: 'regional_restriction.registration_enabled',
        value: false,
      },
      {
        key: 'regional_restriction.registration_enabled',
        value: false,
      },
      {
        key: 'regional_restriction.blocked_country_codes',
        value: '["CN","US"]',
      },
    ])

    await act(async () => saveButton.click())
    await flushAsyncWork()
    assert.equal(requests.length, 3)
  })
})
