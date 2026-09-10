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
  'HTMLDivElement',
  'Event',
  'Node',
  'Element',
  'requestAnimationFrame',
  'cancelAnimationFrame',
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
const { useStickToLatestMessage } =
  await import('../use-stick-to-latest-message')

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function StickProbe({
  latestMessageID,
  loading = false,
  loadingOlderMessages = false,
  messagesLength = 1,
}: {
  latestMessageID?: string
  loading?: boolean
  loadingOlderMessages?: boolean
  messagesLength?: number
}) {
  const stick = useStickToLatestMessage({
    latestMessageID,
    loading,
    loadingOlderMessages,
    messagesLength,
  })

  return React.createElement(
    'div',
    {
      ref: stick.messageListRef,
      'data-testid': 'message-list',
      onScroll: stick.handleScroll,
    },
    stick.hasNewMessages
      ? React.createElement('span', { 'data-testid': 'new-messages' }, 'new')
      : null,
    React.createElement('div', { ref: stick.endRef })
  )
}

function mockListMetrics(list: HTMLDivElement, scrollHeight: number) {
  Object.defineProperty(list, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
  Object.defineProperty(list, 'clientHeight', {
    configurable: true,
    get: () => 200,
  })
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      globalThis.requestAnimationFrame(() => resolve())
    })
  })
}

afterEach(() => {
  document.body.replaceChildren()
})

after(() => {
  domWindow.close()
})

describe('stick to latest support message', () => {
  test('keeps the viewport on a newly sent or received message', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        React.createElement(StickProbe, {
          latestMessageID: 'm1',
          messagesLength: 1,
        })
      )
    })

    const list = host.querySelector<HTMLDivElement>(
      '[data-testid="message-list"]'
    )
    assert.ok(list)
    mockListMetrics(list, 800)
    list.scrollTop = 0

    await act(async () => {
      root.render(
        React.createElement(StickProbe, {
          latestMessageID: 'm2',
          messagesLength: 2,
        })
      )
    })
    await flushAnimationFrame()

    assert.equal(list.scrollTop, 800)
    assert.equal(host.querySelector('[data-testid="new-messages"]'), null)

    await act(async () => root.unmount())
    host.remove()
  })

  test('does not steal the viewport when the reader has scrolled up', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        React.createElement(StickProbe, {
          latestMessageID: 'm1',
          messagesLength: 1,
        })
      )
    })

    const list = host.querySelector<HTMLDivElement>(
      '[data-testid="message-list"]'
    )
    assert.ok(list)
    mockListMetrics(list, 800)
    list.scrollTop = 0
    await act(async () => {
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    await act(async () => {
      root.render(
        React.createElement(StickProbe, {
          latestMessageID: 'm2',
          messagesLength: 2,
        })
      )
    })
    await flushAnimationFrame()

    assert.equal(list.scrollTop, 0)
    assert.ok(host.querySelector('[data-testid="new-messages"]'))

    await act(async () => root.unmount())
    host.remove()
  })
})
