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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  getSupportContext,
  getSupportMessages,
  sendSupportMessage,
} from '../api'
import type {
  SendSupportMessageInput,
  SupportMessage,
  SupportMessagesPage,
  SupportPageContext,
} from '../types'

const SUPPORT_CONTEXT_QUERY_KEY = 'support-context'
const SUPPORT_MESSAGES_QUERY_KEY = 'support-messages'
const EMPTY_SUPPORT_MESSAGE_PAGES: SupportMessagesPage[] = []

type SeenAgentMessage = {
  createdAt: string
  id: string
}

function seenMessageStorageKey(userID?: number): string | null {
  return userID ? `newapi-support-seen:${userID}` : null
}

function loadSeenAgentMessage(userID?: number): SeenAgentMessage | null {
  const key = seenMessageStorageKey(userID)
  if (!key || typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SeenAgentMessage>
    if (
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      !parsed.createdAt ||
      !parsed.id
    ) {
      return null
    }
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    return null
  }
}

function saveSeenAgentMessage(
  userID: number | undefined,
  message: SeenAgentMessage | null
): void {
  const key = seenMessageStorageKey(userID)
  if (!key || typeof window === 'undefined') return

  try {
    if (message) {
      window.localStorage.setItem(key, JSON.stringify(message))
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Local storage is an enhancement; private browsing and quota errors are safe to ignore.
  }
}

function compareMessagePosition(
  left: SeenAgentMessage,
  right: SeenAgentMessage
): number {
  const timestampDifference =
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  return timestampDifference || left.id.localeCompare(right.id)
}

export function countUnreadAgentMessages(
  messages: SupportMessage[],
  seen: SeenAgentMessage | null
): number {
  return messages.filter((message) => {
    if (message.author !== 'agent') return false
    if (!seen) return true
    return compareMessagePosition(message, seen) > 0
  }).length
}

function latestAgentMessage(messages: SupportMessage[]): SupportMessage | null {
  return messages.reduce<SupportMessage | null>((latest, message) => {
    if (message.author !== 'agent') return latest
    if (!latest || compareMessagePosition(message, latest) > 0) {
      return message
    }
    return latest
  }, null)
}

type OlderMessagesState = {
  userID?: number
  pages: SupportMessagesPage[]
  error: Error | null
  isLoading: boolean
}

function mergeMessages(...messageGroups: Array<SupportMessage[] | undefined>) {
  const messages = new Map<string, SupportMessage>()

  for (const group of messageGroups) {
    for (const message of group ?? []) {
      const key = message.clientMessageId || message.id
      const previous = messages.get(key)
      if (!previous || previous.author === 'user') {
        messages.set(key, message)
      }
    }
  }

  return [...messages.values()].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  )
}

export function useSupportConversation(
  open: boolean,
  authenticated: boolean,
  page: SupportPageContext,
  userID?: number
) {
  const queryClient = useQueryClient()
  // Keep the lightweight context/history poll active while the widget is
  // closed so the floating action button can surface administrator replies.
  // The actual message panel still only renders when `open` is true.
  const enabled = authenticated
  const [olderMessagesState, setOlderMessagesState] =
    useState<OlderMessagesState>({
      pages: [],
      error: null,
      isLoading: false,
    })
  const [pendingMessagesByUser, setPendingMessagesByUser] = useState<
    Record<string, SupportMessage[]>
  >({})
  const seenAgentMessage = loadSeenAgentMessage(userID)

  const contextQuery = useQuery({
    queryKey: [
      SUPPORT_CONTEXT_QUERY_KEY,
      userID,
      page.path,
      page.title,
      page.section,
    ],
    queryFn: () => getSupportContext(page),
    enabled,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    retry: 1,
  })
  const messagesQuery = useQuery({
    queryKey: [SUPPORT_MESSAGES_QUERY_KEY, userID],
    queryFn: () => getSupportMessages(),
    enabled:
      enabled &&
      contextQuery.isSuccess &&
      Boolean(contextQuery.data?.conversation),
    staleTime: 10_000,
    refetchInterval:
      enabled && Boolean(contextQuery.data?.conversation) ? 15_000 : false,
    retry: 1,
  })
  const sendMutation = useMutation({
    mutationFn: sendSupportMessage,
    onMutate: (input) => {
      const optimisticMessage: SupportMessage = {
        id: `pending-${input.clientMessageId}`,
        text: input.text,
        author: 'user',
        kind: 'text',
        createdAt: new Date().toISOString(),
        clientMessageId: input.clientMessageId,
      }
      const ownerKey = String(userID ?? '')
      setPendingMessagesByUser((current) => ({
        ...current,
        [ownerKey]: mergeMessages(current[ownerKey], [optimisticMessage]),
      }))
      return { optimisticMessageID: optimisticMessage.id, ownerKey }
    },
    onError: (_error, _input, context) => {
      if (!context?.optimisticMessageID || !context.ownerKey) return
      setPendingMessagesByUser((current) => ({
        ...current,
        [context.ownerKey]: (current[context.ownerKey] ?? []).filter(
          (message) => message.id !== context.optimisticMessageID
        ),
      }))
    },
    onSuccess: (message, _input, context) => {
      if (context?.optimisticMessageID && context.ownerKey) {
        setPendingMessagesByUser((current) => ({
          ...current,
          [context.ownerKey]: (current[context.ownerKey] ?? []).filter(
            (item) => item.id !== context.optimisticMessageID
          ),
        }))
      }
      if (message) {
        queryClient.setQueryData<SupportMessagesPage>(
          [SUPPORT_MESSAGES_QUERY_KEY, userID],
          (current) => ({
            messages: mergeMessages(current?.messages, [message]),
            nextCursor: current?.nextCursor,
          })
        )
      }
      void queryClient.invalidateQueries({
        queryKey: [SUPPORT_MESSAGES_QUERY_KEY, userID],
      })
      void queryClient.invalidateQueries({
        queryKey: [SUPPORT_CONTEXT_QUERY_KEY, userID],
      })
    },
  })
  const isCurrentOlderMessagesState =
    enabled && olderMessagesState.userID === userID
  const olderPages = isCurrentOlderMessagesState
    ? olderMessagesState.pages
    : EMPTY_SUPPORT_MESSAGE_PAGES
  const olderMessagesError = isCurrentOlderMessagesState
    ? olderMessagesState.error
    : null
  const isLoadingOlderMessages = isCurrentOlderMessagesState
    ? olderMessagesState.isLoading
    : false
  const nextCursor =
    olderPages.at(-1)?.nextCursor ?? messagesQuery.data?.nextCursor
  const loadOlderMessages = useCallback(async () => {
    if (!enabled || !nextCursor || isLoadingOlderMessages) return

    setOlderMessagesState((current) => ({
      userID,
      pages: current.userID === userID ? current.pages : [],
      error: null,
      isLoading: true,
    }))
    try {
      const page = await getSupportMessages(nextCursor)
      setOlderMessagesState((current) => {
        if (current.userID !== userID) return current
        return {
          userID,
          pages: [...current.pages, page],
          error: null,
          isLoading: false,
        }
      })
    } catch (error) {
      setOlderMessagesState((current) => {
        if (current.userID !== userID) return current
        return {
          userID,
          pages: current.pages,
          error:
            error instanceof Error
              ? error
              : new Error('Unable to load support'),
          isLoading: false,
        }
      })
    }
  }, [enabled, isLoadingOlderMessages, nextCursor, userID])
  const messages = useMemo(() => {
    const pendingMessages = pendingMessagesByUser[String(userID ?? '')] ?? []
    return mergeMessages(
      contextQuery.data?.messages,
      messagesQuery.data?.messages,
      ...olderPages.map((page) => page.messages),
      pendingMessages
    )
  }, [
    contextQuery.data?.messages,
    messagesQuery.data?.messages,
    olderPages,
    pendingMessagesByUser,
    userID,
  ])

  const unreadCount = useMemo(() => {
    if (open) return 0
    return countUnreadAgentMessages(messages, seenAgentMessage)
  }, [messages, open, seenAgentMessage])

  const hasSeenAgentMessage = Boolean(seenAgentMessage)

  useEffect(() => {
    if (!open || contextQuery.isLoading || messagesQuery.isLoading) return
    const latest = latestAgentMessage(messages)
    if (!latest) return

    const nextSeenAgentMessage = {
      createdAt: latest.createdAt,
      id: latest.id,
    }
    saveSeenAgentMessage(userID, nextSeenAgentMessage)
  }, [contextQuery.isLoading, messages, messagesQuery.isLoading, open, userID])

  let visibleUnreadCount = unreadCount
  if (open) {
    visibleUnreadCount = 0
  } else if (!hasSeenAgentMessage) {
    visibleUnreadCount = Math.max(
      unreadCount,
      contextQuery.data?.unreadCount ?? 0
    )
  }

  return {
    messages,
    unreadCount: visibleUnreadCount,
    isLoading:
      messages.length === 0 &&
      (contextQuery.isLoading || messagesQuery.isLoading),
    isRefreshing: contextQuery.isFetching || messagesQuery.isFetching,
    error: contextQuery.error ?? messagesQuery.error,
    olderMessagesError,
    sendError: sendMutation.error,
    isSending: sendMutation.isPending,
    hasOlderMessages: Boolean(nextCursor),
    isLoadingOlderMessages,
    loadOlderMessages,
    send: (input: SendSupportMessageInput) => sendMutation.mutateAsync(input),
    retry: () => {
      void contextQuery.refetch()
      void messagesQuery.refetch()
    },
  }
}
