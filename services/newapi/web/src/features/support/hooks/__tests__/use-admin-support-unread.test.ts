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

import type { AdminSupportConversation } from '../../admin-api'
import {
  countUnreadAdminConversations,
  type SeenConversations,
} from '../use-admin-support-unread'

const seen: SeenConversations = {
  'conversation-user': '2026-09-10T10:00:00.000Z',
  'conversation-admin': '2026-09-10T10:00:00.000Z',
  'conversation-old': '2026-09-10T10:00:00.000Z',
}

function conversation(
  id: string,
  updatedAt: string,
  lastMessageIsAdmin: boolean | null | undefined
): AdminSupportConversation {
  return {
    id,
    updatedAt,
    lastMessageIsAdmin,
  }
}

describe('admin support unread count', () => {
  test('counts a newer user message but ignores an administrator reply', () => {
    const conversations = [
      conversation('conversation-user', '2026-09-10T10:01:00.000Z', false),
      conversation('conversation-admin', '2026-09-10T10:02:00.000Z', true),
    ]

    assert.equal(countUnreadAdminConversations(conversations, seen), 1)
  })

  test('does not count equal or older activity, or unknown message authors', () => {
    const conversations = [
      conversation('conversation-user', '2026-09-10T10:00:00.000Z', false),
      conversation('conversation-old', '2026-09-10T09:59:00.000Z', false),
      conversation('conversation-admin', '2026-09-10T10:03:00.000Z', null),
    ]

    assert.equal(countUnreadAdminConversations(conversations, seen), 0)
  })
})
