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
import { api } from '@/lib/api'

import type { SupportMessage } from './types'

type ApiEnvelope<T> = {
  success: boolean
  message?: string
  data?: T
}

type AdminSupportMessageWire = {
  id?: string | number
  message_id?: string | number
  text?: string
  content?: string
  author?: string
  sender?: string
  role?: string
  message_type?: string
  messageType?: string
  created_at?: string | number
  createdAt?: string | number
}

type AdminSupportConversationWire = {
  id?: string | number
  conversation_id?: string | number
  conversationId?: string | number
  user_id?: number | string
  userId?: number | string
  external_user_id?: number | string
  externalUserId?: number | string
  username?: string
  user_name?: string
  userName?: string
  external_username?: string
  externalUsername?: string
  display_name?: string
  displayName?: string
  email?: string
  external_email?: string
  externalEmail?: string
  status?: string
  page_context?: {
    path?: string
    title?: string
    section?: string
  }
  pageContext?: {
    path?: string
    title?: string
    section?: string
  }
  created_at?: string | number
  createdAt?: string | number
  updated_at?: string | number
  updatedAt?: string | number
  last_message_is_admin?: boolean | null
  lastMessageIsAdmin?: boolean | null
}

type AdminConversationsData =
  | AdminSupportConversationWire[]
  | {
      conversations?: AdminSupportConversationWire[]
      items?: AdminSupportConversationWire[]
      rows?: AdminSupportConversationWire[]
      next_cursor?: string
      nextCursor?: string
    }

type AdminMessagesData =
  | AdminSupportMessageWire[]
  | {
      messages?: AdminSupportMessageWire[]
      items?: AdminSupportMessageWire[]
      rows?: AdminSupportMessageWire[]
      next_cursor?: string
      nextCursor?: string
    }

export type AdminSupportConversation = {
  id: string
  userId?: number
  username?: string
  displayName?: string
  email?: string
  status?: string
  pageContext?: {
    path?: string
    title?: string
    section?: string
  }
  createdAt?: string
  updatedAt?: string
  lastMessageIsAdmin?: boolean | null
}

export type AdminSupportMessage = SupportMessage

export type AdminSupportConversationsPage = {
  conversations: AdminSupportConversation[]
  nextCursor?: string
}

export type AdminSupportMessagesPage = {
  messages: AdminSupportMessage[]
  nextCursor?: string
}

function unwrap<T>(response: { data: ApiEnvelope<T> }): T {
  if (!response.data.success) {
    throw new Error(response.data.message || 'Support request failed')
  }
  return response.data.data as T
}

function normalizeTimestamp(
  value: string | number | undefined
): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(
      value > 1_000_000_000_000 ? value : value * 1000
    ).toISOString()
  }
  return typeof value === 'string' ? value : undefined
}

function normalizeLastMessageIsAdmin(
  value: AdminSupportConversationWire
): boolean | null {
  if (typeof value.last_message_is_admin === 'boolean') {
    return value.last_message_is_admin
  }
  if (typeof value.lastMessageIsAdmin === 'boolean') {
    return value.lastMessageIsAdmin
  }
  return null
}

function normalizeMessage(
  value: AdminSupportMessageWire
): AdminSupportMessage | null {
  const id = value.id ?? value.message_id
  const text = String(value.text ?? value.content ?? '').trim()
  if (id === undefined || id === null || !text) return null

  const authorValue = value.author ?? value.sender ?? value.role
  let author: SupportMessage['author'] = 'user'
  if (
    authorValue === 'admin' ||
    authorValue === 'agent' ||
    authorValue === 'assistant'
  ) {
    author = 'agent'
  } else if (authorValue === 'system') {
    author = 'system'
  }

  return {
    id: String(id),
    text,
    author,
    kind:
      value.message_type === 'image' || value.messageType === 'image'
        ? 'image'
        : 'text',
    createdAt:
      normalizeTimestamp(value.created_at ?? value.createdAt) ??
      new Date().toISOString(),
  }
}

function readMessages(
  data: AdminMessagesData | undefined
): AdminSupportMessage[] {
  const values = Array.isArray(data)
    ? data
    : (data?.messages ?? data?.items ?? data?.rows ?? [])
  return values
    .map(normalizeMessage)
    .filter((message): message is AdminSupportMessage => message !== null)
}

function readConversations(
  data: AdminConversationsData | undefined
): AdminSupportConversation[] {
  const values = Array.isArray(data)
    ? data
    : (data?.conversations ?? data?.items ?? data?.rows ?? [])

  return values
    .map<AdminSupportConversation | null>((value) => {
      const id = value.conversation_id ?? value.conversationId ?? value.id
      if (id === undefined || id === null) return null

      const userId = Number(value.user_id ?? value.userId)
      const externalUserId = Number(
        value.external_user_id ?? value.externalUserId
      )
      let normalizedUserId: number | undefined
      if (Number.isFinite(userId) && userId > 0) {
        normalizedUserId = userId
      } else if (Number.isFinite(externalUserId) && externalUserId > 0) {
        normalizedUserId = externalUserId
      }
      return {
        id: String(id),
        ...(normalizedUserId !== undefined ? { userId: normalizedUserId } : {}),
        username:
          value.username ??
          value.user_name ??
          value.userName ??
          value.external_username ??
          value.externalUsername,
        displayName:
          value.display_name ??
          value.displayName ??
          value.external_username ??
          value.externalUsername,
        email: value.email ?? value.external_email ?? value.externalEmail,
        status: value.status,
        pageContext: value.page_context ?? value.pageContext,
        createdAt: normalizeTimestamp(value.created_at ?? value.createdAt),
        updatedAt: normalizeTimestamp(value.updated_at ?? value.updatedAt),
        lastMessageIsAdmin: normalizeLastMessageIsAdmin(value),
      }
    })
    .filter(
      (conversation): conversation is AdminSupportConversation =>
        conversation !== null
    )
}

function readNextCursor(
  data: AdminConversationsData | AdminMessagesData | undefined
): string | undefined {
  if (!data || Array.isArray(data)) return undefined
  const cursor = data.next_cursor ?? data.nextCursor
  return typeof cursor === 'string' && cursor ? cursor : undefined
}

function readConversationsPage(
  data: AdminConversationsData | undefined
): AdminSupportConversationsPage {
  return {
    conversations: readConversations(data),
    nextCursor: readNextCursor(data),
  }
}

function readMessagesPage(
  data: AdminMessagesData | undefined
): AdminSupportMessagesPage {
  return {
    messages: readMessages(data),
    nextCursor: readNextCursor(data),
  }
}

export async function getAdminSupportConversations(
  cursor?: string
): Promise<AdminSupportConversationsPage> {
  const response = await api.get<ApiEnvelope<AdminConversationsData>>(
    '/api/admin/support/conversations',
    {
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
      skipBusinessError: true,
      skipErrorHandler: true,
      disableDuplicate: true,
    }
  )
  return readConversationsPage(unwrap(response))
}

export async function getAdminSupportMessages(
  conversationID: string,
  cursor?: string
): Promise<AdminSupportMessagesPage> {
  const response = await api.get<ApiEnvelope<AdminMessagesData>>(
    `/api/admin/support/conversations/${encodeURIComponent(conversationID)}/messages`,
    {
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
      skipBusinessError: true,
      skipErrorHandler: true,
      disableDuplicate: true,
    }
  )
  return readMessagesPage(unwrap(response))
}

export async function sendAdminSupportMessage(
  conversationID: string,
  text: string
): Promise<AdminSupportMessage | null> {
  const response = await api.post<ApiEnvelope<AdminSupportMessageWire>>(
    `/api/admin/support/conversations/${encodeURIComponent(conversationID)}/messages`,
    {
      text,
      client_message_id:
        typeof globalThis.crypto?.randomUUID === 'function'
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    {
      skipBusinessError: true,
      skipErrorHandler: true,
    }
  )
  const message = normalizeMessage(unwrap(response))
  return message ? { ...message, author: 'agent' } : null
}

export const __adminSupportTestUtils = {
  normalizeMessage,
  readMessages,
  readConversations,
  readMessagesPage,
  readConversationsPage,
}
