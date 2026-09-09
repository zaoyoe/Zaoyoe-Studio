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
*/
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { api } from '@/lib/api'

import {
  __adminSupportTestUtils,
  getAdminSupportConversations,
  getAdminSupportMessages,
  sendAdminSupportMessage,
} from '../admin-api'

const originalGet = api.get
const originalPost = api.post

afterEach(() => {
  api.get = originalGet
  api.post = originalPost
})

describe('admin support API contract', () => {
  test('normalizes the shared conversation and message wire shapes', () => {
    const [conversation] = __adminSupportTestUtils.readConversations({
      conversations: [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          external_user_id: '42',
          external_username: 'newapi-user',
          external_email: 'user@example.com',
          page_context: { path: '/dashboard' },
          updated_at: '2026-09-09T12:00:00.000Z',
        },
      ],
    })
    assert.ok(conversation)
    assert.equal(conversation.id, '123e4567-e89b-12d3-a456-426614174000')
    assert.equal(conversation.userId, 42)
    assert.equal(conversation.username, 'newapi-user')
    assert.deepEqual(conversation.pageContext, { path: '/dashboard' })

    const [message] = __adminSupportTestUtils.readMessages({
      messages: [
        {
          id: 'message-1',
          content: 'Administrator reply',
          author: 'admin',
          message_type: 'text',
          created_at: '2026-09-09T12:01:00.000Z',
        },
      ],
    })
    assert.ok(message)
    assert.deepEqual(message, {
      id: 'message-1',
      text: 'Administrator reply',
      author: 'agent',
      kind: 'text',
      createdAt: '2026-09-09T12:01:00.000Z',
    })
  })

  test('sends an administrator reply with an idempotency key', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = []
    api.post = (async (url: string, body: Record<string, unknown>) => {
      requests.push({ url, body })
      return {
        data: {
          success: true,
          data: {
            id: 'message-2',
            content: 'Acknowledged',
            is_admin: true,
            created_at: '2026-09-09T12:02:00.000Z',
          },
        },
      }
    }) as typeof api.post

    const message = await sendAdminSupportMessage(
      '123e4567-e89b-12d3-a456-426614174000',
      'Acknowledged'
    )

    assert.ok(message)
    assert.equal(message.author, 'agent')
    assert.equal(requests.length, 1)
    assert.equal(
      requests[0]?.url,
      '/api/admin/support/conversations/123e4567-e89b-12d3-a456-426614174000/messages'
    )
    const clientMessageID = requests[0]?.body.client_message_id
    assert.equal(typeof clientMessageID, 'string')
    assert.match(
      clientMessageID as string,
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
    )
    assert.equal(requests[0]?.body.text, 'Acknowledged')
  })

  test('forwards cursors and reads paginated administrator responses', async () => {
    const requests: Array<{
      url: string
      params?: Record<string, unknown>
    }> = []
    api.get = (async (
      url: string,
      config?: { params?: Record<string, unknown> }
    ) => {
      requests.push({ url, params: config?.params })
      return {
        data: {
          success: true,
          data: url.endsWith('/messages')
            ? {
                messages: [
                  {
                    id: 'message-3',
                    content: 'Earlier customer message',
                    created_at: '2026-09-09T11:59:00.000Z',
                  },
                ],
                next_cursor: 'older-message-cursor',
              }
            : {
                conversations: [
                  {
                    id: '123e4567-e89b-12d3-a456-426614174000',
                    external_username: 'newapi-user',
                  },
                ],
                next_cursor: 'older-conversation-cursor',
              },
        },
      }
    }) as typeof api.get

    const conversations = await getAdminSupportConversations('next-page')
    const messages = await getAdminSupportMessages(
      '123e4567-e89b-12d3-a456-426614174000',
      'previous-page'
    )

    assert.equal(conversations.nextCursor, 'older-conversation-cursor')
    assert.equal(conversations.conversations[0]?.username, 'newapi-user')
    assert.equal(messages.nextCursor, 'older-message-cursor')
    assert.equal(messages.messages[0]?.text, 'Earlier customer message')
    assert.deepEqual(requests[0]?.params, {
      limit: 50,
      cursor: 'next-page',
    })
    assert.deepEqual(requests[1]?.params, {
      limit: 50,
      cursor: 'previous-page',
    })
  })
})
