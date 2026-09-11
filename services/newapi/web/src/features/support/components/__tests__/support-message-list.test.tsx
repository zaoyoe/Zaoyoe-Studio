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
  'HTMLImageElement',
  'HTMLAnchorElement',
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
const { SupportMessageList } = await import('../support-message-list')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        You: 'You',
        Support: 'Support',
        'Support team': 'Support team',
        'Support conversation': 'Support conversation',
        'Support image': 'Support image',
        'Start a support conversation': 'Start a support conversation',
        'Choose what you need help with or describe what happened.':
          'Choose what you need help with or describe what happened.',
        'Unable to load support': 'Unable to load support',
        'Try again': 'Try again',
        'Unable to load older messages': 'Unable to load older messages',
        'Loading older messages': 'Loading older messages',
        'Load older messages': 'Load older messages',
        'Jump to latest message': 'Jump to latest message',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

type SupportMessageListMessage = {
  id: string
  text: string
  author: 'user' | 'agent' | 'system'
  kind: 'text' | 'image'
  createdAt: string
}

type RenderedMessageList = {
  host: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

const defaultMessages: SupportMessageListMessage[] = [
  {
    id: 'agent-1',
    text: 'Hi',
    author: 'agent',
    kind: 'text',
    createdAt: '2026-09-09T12:00:00.000Z',
  },
  {
    id: 'user-1',
    text: 'A longer customer message should remain readable.',
    author: 'user',
    kind: 'text',
    createdAt: '2026-09-09T12:01:00.000Z',
  },
]

async function renderMessageList(
  messages: SupportMessageListMessage[] = defaultMessages
): Promise<RenderedMessageList> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  await act(async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <SupportMessageList
          messages={messages}
          loading={false}
          error={null}
          hasOlderMessages={false}
          loadingOlderMessages={false}
          olderMessagesError={null}
          onLoadOlderMessages={() => undefined}
          onRetry={() => undefined}
        />
      </I18nextProvider>
    )
  })

  return { host, root }
}

afterEach(async () => {
  document.body.replaceChildren()
  await i18n.changeLanguage('en')
})

after(() => {
  domWindow.close()
})

describe('Support message list', () => {
  test('sizes every text bubble to its content and keeps text left-aligned', async () => {
    const rendered = await renderMessageList()
    const messageList = rendered.host.querySelector<HTMLElement>(
      '[data-testid="support-message-list"]'
    )
    assert.ok(messageList)

    const bubbles = [...messageList.querySelectorAll('p')]
    assert.equal(bubbles.length, 2)
    assert.equal(bubbles[0]?.textContent, 'Hi')
    assert.equal(
      bubbles[1]?.textContent,
      'A longer customer message should remain readable.'
    )
    for (const bubble of bubbles) {
      assert.equal(bubble.classList.contains('w-max'), true)
      assert.equal(bubble.classList.contains('max-w-[84%]'), true)
      assert.equal(bubble.classList.contains('text-left'), true)
    }

    const articles = [...messageList.querySelectorAll('article')]
    assert.equal(articles.length, 2)
    assert.equal(articles[0]?.classList.contains('w-full'), true)
    assert.equal(articles[0]?.classList.contains('items-start'), true)
    assert.equal(articles[1]?.classList.contains('w-full'), true)
    assert.equal(articles[1]?.classList.contains('items-end'), true)

    const timestamps = [
      ...messageList.querySelectorAll('[data-testid="support-message-time"]'),
    ]
    assert.equal(timestamps.length, 2)
    assert.equal(
      timestamps[0]?.getAttribute('dateTime'),
      '2026-09-09T12:00:00.000Z'
    )
    assert.equal(
      timestamps[1]?.getAttribute('dateTime'),
      '2026-09-09T12:01:00.000Z'
    )
    const labels = timestamps.map(
      (timestamp) => timestamp.textContent?.trim() || ''
    )
    assert.equal(labels.every(Boolean), true)
    assert.ok((labels[0] || '').length > (labels[1] || '').length)

    await act(async () => rendered.root.unmount())
    rendered.host.remove()
  })

  test('renders first-party images for both sides and falls back r2.dev URLs to text', async () => {
    const rendered = await renderMessageList([
      {
        id: 'agent-image',
        text: 'https://cdn.fatherkey.com/chat/session/agent.webp',
        author: 'agent',
        kind: 'image',
        createdAt: '2026-09-09T12:00:00.000Z',
      },
      {
        id: 'user-image',
        text: 'https://cdn.fatherkey.com/chat/session/user.webp',
        author: 'user',
        kind: 'image',
        createdAt: '2026-09-09T12:01:00.000Z',
      },
      {
        id: 'blocked-image',
        text: 'https://pub-123.r2.dev/chat/session/pixel.png',
        author: 'user',
        kind: 'image',
        createdAt: '2026-09-09T12:02:00.000Z',
      },
    ])
    const messageList = rendered.host.querySelector<HTMLElement>(
      '[data-testid="support-message-list"]'
    )
    assert.ok(messageList)

    const images = [...messageList.querySelectorAll('img')]
    assert.equal(images.length, 2)
    assert.equal(
      images[0]?.getAttribute('src'),
      'https://cdn.fatherkey.com/chat/session/agent.webp'
    )
    assert.equal(
      images[1]?.getAttribute('src'),
      'https://cdn.fatherkey.com/chat/session/user.webp'
    )
    for (const image of images) {
      assert.equal(image.getAttribute('alt'), 'Support image')
    }

    const fallbackBubbles = [...messageList.querySelectorAll('p')]
    assert.equal(fallbackBubbles.length, 1)
    assert.equal(
      fallbackBubbles[0]?.textContent,
      'https://pub-123.r2.dev/chat/session/pixel.png'
    )
    assert.equal(messageList.querySelector('img[src*="r2.dev"]'), null)

    await act(async () => rendered.root.unmount())
    rendered.host.remove()
  })
})
