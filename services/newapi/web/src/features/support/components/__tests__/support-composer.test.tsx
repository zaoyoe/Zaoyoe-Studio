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

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLTextAreaElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'KeyboardEvent',
  'PointerEvent',
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

const React = await import('react')
const { act } = React
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { TooltipProvider } = await import('@/components/ui/tooltip')
const { SupportComposer } = await import('../support-composer')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Message support': 'Message support',
        'Describe what you need help with...':
          'Describe what you need help with...',
        'Send message': 'Send message',
        'Press Enter to send, Shift+Enter for a new line':
          'Press Enter to send, Shift+Enter for a new line',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type ComposerTestProps = {
  value: string
  disabled?: boolean
  sending?: boolean
  onSubmit: () => void
}

type RenderedComposer = {
  host: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

async function renderComposer(
  props: ComposerTestProps
): Promise<RenderedComposer> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <SupportComposer
            value={props.value}
            disabled={props.disabled ?? false}
            sending={props.sending ?? false}
            onTextareaMount={() => undefined}
            onValueChange={() => undefined}
            onSubmit={props.onSubmit}
          />
        </TooltipProvider>
      </I18nextProvider>
    )
  })

  return { host, root }
}

function getTextarea(host: ParentNode): HTMLTextAreaElement {
  const textarea = host.querySelector<HTMLTextAreaElement>('#support-message')
  assert.ok(textarea)
  return textarea
}

function getSendButton(host: ParentNode): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Send message"]'
  )
  assert.ok(button)
  return button
}

afterEach(async () => {
  document.body.replaceChildren()
  await i18n.changeLanguage('en')
})

after(() => {
  domWindow.close()
})

describe('Support composer', () => {
  test('submits a populated message with Enter while Shift+Enter keeps editing', async () => {
    let submitCount = 0
    const rendered = await renderComposer({
      value: 'Please help with this request',
      onSubmit: () => {
        submitCount += 1
      },
    })
    const textarea = getTextarea(rendered.host)

    const shiftEnter = new domWindow.KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () =>
      textarea.dispatchEvent(shiftEnter as unknown as Event)
    )
    assert.equal(submitCount, 0)
    assert.equal(shiftEnter.defaultPrevented, false)

    const enter = new domWindow.KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => textarea.dispatchEvent(enter as unknown as Event))
    assert.equal(submitCount, 1)
    assert.equal(enter.defaultPrevented, true)

    await act(async () => rendered.root.unmount())
    rendered.host.remove()
  })

  test('disables the input and send control while sending is unavailable', async () => {
    const rendered = await renderComposer({
      value: 'A message that must wait',
      disabled: true,
      onSubmit: () => undefined,
    })
    const textarea = getTextarea(rendered.host)
    const sendButton = getSendButton(rendered.host)

    assert.equal(textarea.disabled, true)
    assert.equal(sendButton.disabled, true)

    await act(async () => rendered.root.unmount())
    rendered.host.remove()
  })
})
