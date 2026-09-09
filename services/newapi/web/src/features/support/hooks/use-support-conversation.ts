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
import { useCallback, useMemo, useState } from 'react'

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
  const enabled = open && authenticated
  const [olderMessagesState, setOlderMessagesState] =
    useState<OlderMessagesState>({
      pages: [],
      error: null,
      isLoading: false,
    })
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
    staleTime: 30_000,
    retry: 1,
  })
  const messagesQuery = useQuery({
    queryKey: [SUPPORT_MESSAGES_QUERY_KEY, userID],
    queryFn: () => getSupportMessages(),
    enabled: enabled && contextQuery.isSuccess,
    staleTime: 10_000,
    refetchInterval: enabled ? 15_000 : false,
    retry: 1,
  })
  const sendMutation = useMutation({
    mutationFn: sendSupportMessage,
    onSuccess: (message) => {
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
  const messages = useMemo(
    () =>
      mergeMessages(
        contextQuery.data?.messages,
        messagesQuery.data?.messages,
        ...olderPages.map((page) => page.messages)
      ),
    [contextQuery.data?.messages, messagesQuery.data?.messages, olderPages]
  )

  return {
    messages,
    unreadCount: contextQuery.data?.unreadCount ?? 0,
    isLoading: contextQuery.isLoading || messagesQuery.isLoading,
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
