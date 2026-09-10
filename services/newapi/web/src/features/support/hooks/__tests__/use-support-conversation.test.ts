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
import { describe, test } from 'node:test'

import type { SupportMessage } from '../../types'
import { countUnreadAgentMessages } from '../use-support-conversation'

function message(
  id: string,
  author: SupportMessage['author'],
  createdAt: string
): SupportMessage {
  return {
    id,
    text: id,
    author,
    kind: 'text',
    createdAt,
  }
}

describe('user support unread count', () => {
  test('counts administrator replies that arrived after the last seen message', () => {
    const messages = [
      message('user-1', 'user', '2026-09-10T10:00:00.000Z'),
      message('agent-1', 'agent', '2026-09-10T10:01:00.000Z'),
      message('agent-2', 'agent', '2026-09-10T10:02:00.000Z'),
    ]

    assert.equal(
      countUnreadAgentMessages(messages, {
        createdAt: '2026-09-10T10:01:00.000Z',
        id: 'agent-1',
      }),
      1
    )
  })

  test('treats every administrator reply as unread before the conversation is opened', () => {
    const messages = [
      message('agent-1', 'agent', '2026-09-10T10:00:00.000Z'),
      message('user-1', 'user', '2026-09-10T10:01:00.000Z'),
      message('agent-2', 'agent', '2026-09-10T10:02:00.000Z'),
    ]

    assert.equal(countUnreadAgentMessages(messages, null), 2)
  })
})
