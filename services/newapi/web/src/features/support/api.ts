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

import axios from 'axios'

import { api } from '@/lib/api'

import type {
  SendSupportMessageInput,
  SupportContext,
  SupportMessage,
  SupportMessagesPage,
  SupportPageContext,
} from './types'

type ApiEnvelope<T> = {
  success: boolean
  code?: string
  message?: string
  data?: T
}

export type SupportApiErrorCode =
  | 'AUTH_SESSION_REQUIRED'
  | 'SUPPORT_GATEWAY_REJECTED'
  | 'SUPPORT_GATEWAY_UNAVAILABLE'

export type SupportApiErrorFallbackKey =
  | 'Unable to load support'
  | 'Unable to send support message'
  | 'Unable to upload image'

export class SupportApiError extends Error {
  readonly code?: string
  readonly fallbackKey: SupportApiErrorFallbackKey

  constructor(fallbackKey: SupportApiErrorFallbackKey, code?: string) {
    super(fallbackKey)
    this.name = 'SupportApiError'
    this.code = code
    this.fallbackKey = fallbackKey
  }
}

type SupportMessageWire = {
  id?: string | number
  text?: string
  content?: string
  author?: string
  sender?: string
  role?: string
  message_type?: string
  messageType?: string
  created_at?: string | number
  createdAt?: string | number
  client_message_id?: string
  clientMessageId?: string
}

type SupportConversationWire = {
  id?: string | number
  conversation_id?: string | number
  status?: string
}

type SupportContextWire = {
  conversation?: SupportConversationWire
  messages?: SupportMessageWire[]
  unread_count?: number
  unreadCount?: number
}

type SupportMessagesPageWire = {
  messages?: SupportMessageWire[]
  items?: SupportMessageWire[]
  next_cursor?: string
  nextCursor?: string
}

export function getSupportApiError(
  error: unknown,
  fallbackKey: SupportApiErrorFallbackKey
): SupportApiError {
  if (error instanceof SupportApiError) return error

  const code = axios.isAxiosError(error)
    ? error.response?.data?.code
    : undefined
  return new SupportApiError(
    fallbackKey,
    typeof code === 'string' ? code : undefined
  )
}

async function requestSupport<T>(
  request: () => Promise<{ data: ApiEnvelope<T> }>,
  fallbackKey: SupportApiErrorFallbackKey
): Promise<ApiEnvelope<T>> {
  try {
    const response = await request()
    if (!response.data.success) {
      throw new SupportApiError(fallbackKey, response.data.code)
    }
    return response.data
  } catch (error) {
    throw getSupportApiError(error, fallbackKey)
  }
}

function normalizeAuthor(value: string | undefined): SupportMessage['author'] {
  if (value === 'agent' || value === 'admin' || value === 'assistant') {
    return 'agent'
  }
  if (value === 'system') return 'system'
  return 'user'
}

function normalizeMessageKind(
  value: string | undefined
): SupportMessage['kind'] {
  return value === 'image' ? 'image' : 'text'
}

function normalizeCreatedAt(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(
      value > 1_000_000_000_000 ? value : value * 1000
    ).toISOString()
  }
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
}

function normalizeMessage(value: SupportMessageWire): SupportMessage | null {
  const text = (value.text ?? value.content ?? '').trim()
  const identifier =
    value.id ?? value.client_message_id ?? value.clientMessageId
  if (!text || identifier === undefined || identifier === null) return null

  return {
    id: String(identifier),
    text,
    author: normalizeAuthor(value.author ?? value.sender ?? value.role),
    kind: normalizeMessageKind(value.message_type ?? value.messageType),
    createdAt: normalizeCreatedAt(value.created_at ?? value.createdAt),
    clientMessageId: value.client_message_id ?? value.clientMessageId,
  }
}

function normalizeMessages(
  values: SupportMessageWire[] | undefined
): SupportMessage[] {
  if (!Array.isArray(values)) return []
  return values
    .map(normalizeMessage)
    .filter((message): message is SupportMessage => message !== null)
}

function serializePage(page: SupportPageContext): Record<string, string> {
  const params: Record<string, string> = { page_path: page.path }
  if (page.title) params.page_title = page.title
  if (page.section) params.page_section = page.section
  return params
}

export async function getSupportContext(
  page: SupportPageContext
): Promise<SupportContext> {
  const response = await requestSupport(
    () =>
      api.get<ApiEnvelope<SupportContextWire>>('/api/user/support/context', {
        params: serializePage(page),
        skipBusinessError: true,
        skipErrorHandler: true,
      }),
    'Unable to load support'
  )

  const data = response.data
  const conversation = data?.conversation
  const conversationID = conversation?.id ?? conversation?.conversation_id
  return {
    conversation: conversation
      ? {
          ...(conversationID !== undefined && conversationID !== null
            ? { id: String(conversationID) }
            : {}),
          status: conversation.status,
        }
      : undefined,
    messages: normalizeMessages(data?.messages),
    unreadCount: data?.unread_count ?? data?.unreadCount ?? 0,
  }
}

export async function getSupportMessages(
  cursor?: string
): Promise<SupportMessagesPage> {
  const response = await requestSupport(
    () =>
      api.get<ApiEnvelope<SupportMessagesPageWire>>(
        '/api/user/support/messages',
        {
          params: {
            limit: 50,
            ...(cursor ? { cursor } : {}),
          },
          skipBusinessError: true,
          skipErrorHandler: true,
          disableDuplicate: true,
        }
      ),
    'Unable to load support'
  )

  const data = response.data
  return {
    messages: normalizeMessages(data?.messages ?? data?.items),
    nextCursor: data?.next_cursor ?? data?.nextCursor,
  }
}

export async function sendSupportMessage(
  input: SendSupportMessageInput
): Promise<SupportMessage | null> {
  const page = {
    path: input.page.path,
    title: input.page.title,
    section: input.page.section,
    request_id: input.page.requestId,
  }
  const payload =
    input.kind === 'image'
      ? {
          message_type: 'image',
          image_data: input.imageData,
          client_message_id: input.clientMessageId,
          page,
        }
      : {
          text: input.text,
          client_message_id: input.clientMessageId,
          page,
        }
  const response = await requestSupport(
    () =>
      api.post<ApiEnvelope<SupportMessageWire>>(
        '/api/user/support/messages',
        payload,
        {
          skipBusinessError: true,
          skipErrorHandler: true,
        }
      ),
    input.kind === 'image'
      ? 'Unable to upload image'
      : 'Unable to send support message'
  )

  return response.data ? normalizeMessage(response.data) : null
}
