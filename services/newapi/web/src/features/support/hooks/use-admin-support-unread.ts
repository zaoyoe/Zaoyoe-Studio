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
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

import {
  getAdminSupportConversations,
  type AdminSupportConversation,
} from '../admin-api'

const ADMIN_SUPPORT_UNREAD_QUERY_KEY = [
  'admin-support-unread-conversations',
] as const
const EMPTY_CONVERSATIONS: AdminSupportConversation[] = []

export type SeenConversations = Record<string, string>

function storageKey(userID?: number): string | null {
  return userID ? `newapi-admin-support-seen:${userID}` : null
}

function loadSeenConversations(userID?: number): SeenConversations {
  const key = storageKey(userID)
  if (!key || typeof window === 'undefined') return {}

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    const result: SeenConversations = {}
    for (const [conversationID, timestamp] of Object.entries(parsed)) {
      if (conversationID && typeof timestamp === 'string') {
        result[conversationID] = timestamp
      }
    }
    return result
  } catch {
    return {}
  }
}

function saveSeenConversations(
  userID: number | undefined,
  seen: SeenConversations
): void {
  const key = storageKey(userID)
  if (!key || typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify(seen))
  } catch {
    // Local storage is only used to avoid repeating an alert after a visit.
  }
}

function conversationActivity(conversation: AdminSupportConversation): string {
  return conversation.updatedAt || conversation.createdAt || ''
}

function activityTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function countUnreadAdminConversations(
  conversations: AdminSupportConversation[],
  seen: SeenConversations
): number {
  return conversations.reduce((count, conversation) => {
    // The inbox activity timestamp advances for both sides of the shared
    // conversation. Only an explicitly user-authored latest message should
    // produce an administrator notification; null stays quiet while older
    // rows are backfilled with the new metadata.
    if (conversation.lastMessageIsAdmin !== false) return count
    const activity = conversationActivity(conversation)
    const timestamp = activityTimestamp(activity)
    if (!timestamp) return count
    const seenTimestamp = activityTimestamp(seen[conversation.id] || '')
    return timestamp > seenTimestamp ? count + 1 : count
  }, 0)
}

export function useAdminSupportUnread(
  enabled: boolean,
  userID: number | undefined,
  pathname: string
): number {
  const seen = loadSeenConversations(userID)

  const query = useQuery({
    queryKey: [...ADMIN_SUPPORT_UNREAD_QUERY_KEY, userID],
    queryFn: () => getAdminSupportConversations(),
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    retry: 1,
  })
  const conversations = query.data?.conversations ?? EMPTY_CONVERSATIONS

  useEffect(() => {
    if (!enabled || pathname !== '/support' || !query.isSuccess) return

    const nextSeen = { ...seen }
    let changed = false
    for (const conversation of conversations) {
      const activity = conversationActivity(conversation)
      if (!activity || nextSeen[conversation.id] === activity) continue
      nextSeen[conversation.id] = activity
      changed = true
    }
    if (changed) {
      saveSeenConversations(userID, nextSeen)
    }
  }, [conversations, enabled, pathname, query.isSuccess, seen, userID])

  if (!enabled || pathname === '/support') return 0
  return countUnreadAdminConversations(conversations, seen)
}

export const __adminSupportUnreadTestUtils = {
  conversationActivity,
  activityTimestamp,
  loadSeenConversations,
  saveSeenConversations,
}
