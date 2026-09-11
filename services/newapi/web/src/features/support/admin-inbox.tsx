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
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ImagePlus,
  Inbox,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  SendHorizontal,
  UserRound,
} from 'lucide-react'
import {
  type ChangeEvent,
  type FormEvent,
  Fragment,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsAdmin } from '@/hooks/use-admin'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

import {
  getAdminSupportConversations,
  getAdminSupportMessages,
  sendAdminSupportMessage,
  type AdminSupportConversation,
  type AdminSupportConversationsPage,
  type AdminSupportMessage,
  type AdminSupportMessagesPage,
} from './admin-api'
import { useStickToLatestMessage } from './hooks/use-stick-to-latest-message'
import { compressSupportImage } from './lib/compress-support-image'
import {
  formatSupportMessageDate,
  formatSupportConversationTime,
  formatSupportMessageTime,
} from './lib/format-support-message-time'
import { getSupportImageUrl } from './lib/support-image-url'

const ADMIN_SUPPORT_QUERY_KEY = ['admin-support-conversations'] as const
const ADMIN_SUPPORT_MESSAGES_QUERY_KEY = 'admin-support-messages'
const MAX_REPLY_LENGTH = 4000

function createOptimisticMessageID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `pending-${globalThis.crypto.randomUUID()}`
  }
  return `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function mergeConversations(
  pages: AdminSupportConversationsPage[] | undefined
): AdminSupportConversation[] {
  const conversations = new Map<string, AdminSupportConversation>()
  for (const page of pages ?? []) {
    for (const conversation of page.conversations) {
      if (!conversations.has(conversation.id)) {
        conversations.set(conversation.id, conversation)
      }
    }
  }
  return [...conversations.values()]
}

function mergeMessages(
  pages: AdminSupportMessagesPage[] | undefined
): AdminSupportMessage[] {
  const messages = new Map<string, AdminSupportMessage>()
  for (const page of pages ?? []) {
    for (const message of page.messages) {
      if (!messages.has(message.id)) {
        messages.set(message.id, message)
      }
    }
  }
  return [...messages.values()].sort((left, right) => {
    const timestampDifference =
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    return timestampDifference || left.id.localeCompare(right.id)
  })
}

function conversationName(conversation: AdminSupportConversation): string {
  return (
    conversation.displayName ||
    conversation.username ||
    conversation.email ||
    conversation.userId?.toString() ||
    conversation.id
  )
}

function ConversationListSkeleton() {
  return (
    <div className='space-y-2 p-3' aria-busy='true'>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className='space-y-2 rounded-lg border p-3'>
          <Skeleton className='h-4 w-2/3' />
          <Skeleton className='h-3 w-full' />
          <Skeleton className='h-3 w-1/3' />
        </div>
      ))}
    </div>
  )
}

function MessageHistory({
  messages,
  loading,
  error,
  onRetry,
  hasOlderMessages,
  loadingOlderMessages,
  olderMessagesError,
  onLoadOlderMessages,
}: {
  messages: AdminSupportMessage[]
  loading: boolean
  error: Error | null
  onRetry: () => void
  hasOlderMessages: boolean
  loadingOlderMessages: boolean
  olderMessagesError: Error | null
  onLoadOlderMessages: () => void
}) {
  const { t } = useTranslation()
  const latestMessageID = messages.at(-1)?.id
  const {
    messageListRef,
    endRef,
    hasNewMessages,
    scrollToLatest,
    handleScroll,
    captureOlderMessagesScrollHeight,
  } = useStickToLatestMessage({
    latestMessageID,
    loading,
    loadingOlderMessages,
    messagesLength: messages.length,
  })

  const handleLoadOlderMessages = useCallback(() => {
    captureOlderMessagesScrollHeight()
    onLoadOlderMessages()
  }, [captureOlderMessagesScrollHeight, onLoadOlderMessages])

  if (loading) {
    return (
      <div
        className='flex min-h-0 flex-1 flex-col items-start gap-4 overflow-y-auto px-4 py-5'
        aria-busy='true'
        aria-label={t('Loading conversation')}
      >
        <div className='max-w-[78%] space-y-2'>
          <Skeleton className='h-3 w-20' />
          <Skeleton className='h-16 w-full' />
        </div>
        <div className='flex max-w-[72%] flex-col items-end gap-2 self-end'>
          <Skeleton className='h-3 w-12' />
          <Skeleton className='h-12 w-full' />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className='flex min-h-0 flex-1 items-center px-4 py-5'>
        <Alert variant='destructive'>
          <CircleAlert aria-hidden='true' />
          <AlertTitle>{t('Unable to load conversation')}</AlertTitle>
          <AlertDescription className='space-y-3'>
            <p>{t('Unable to load conversation')}</p>
            <Button size='sm' variant='outline' onClick={onRetry}>
              <RefreshCw aria-hidden='true' />
              {t('Try again')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!messages.length) {
    return (
      <Empty className='min-h-0 flex-1 rounded-none border-0'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <MessageCircle aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No messages in this conversation')}</EmptyTitle>
          <EmptyDescription>
            {t('The conversation has no messages yet.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div
      className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 [overflow-anchor:none]'
      role='log'
      aria-live='polite'
      aria-label={t('Conversation messages')}
      data-testid='admin-support-message-list'
      ref={messageListRef}
      onScroll={handleScroll}
    >
      {hasOlderMessages && (
        <div className='flex w-full flex-col items-center gap-2'>
          {olderMessagesError && (
            <p className='text-destructive text-xs' role='status'>
              {t('Unable to load older messages')}
            </p>
          )}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={loadingOlderMessages}
            onClick={handleLoadOlderMessages}
          >
            {loadingOlderMessages ? (
              <LoaderCircle
                className='size-4 animate-spin'
                aria-hidden='true'
              />
            ) : (
              <ChevronUp className='size-4' aria-hidden='true' />
            )}
            {loadingOlderMessages
              ? t('Loading older messages')
              : t('Load older messages')}
          </Button>
        </div>
      )}
      {messages.map((message, index) => {
        const isAgent = message.author === 'agent'
        const timestamp = formatSupportMessageTime(message.createdAt)
        const dateLabel = formatSupportMessageDate(
          message.createdAt,
          messages[index - 1]?.createdAt
        )
        const imageUrl =
          message.kind === 'image' ? getSupportImageUrl(message.text) : null
        return (
          <Fragment key={message.id}>
            {dateLabel && (
              <div className='text-muted-foreground flex w-full justify-center py-1 text-xs'>
                <time dateTime={message.createdAt}>{dateLabel}</time>
              </div>
            )}
            <div
              className={cn(
                'flex w-full min-w-0 flex-col gap-1',
                isAgent ? 'items-end' : 'items-start'
              )}
            >
              <div
                className={cn(
                  'text-muted-foreground flex items-center gap-2 text-xs',
                  isAgent && 'justify-end'
                )}
              >
                {timestamp && (
                  <time dateTime={message.createdAt}>{timestamp}</time>
                )}
              </div>
              {imageUrl ? (
                <a
                  href={imageUrl}
                  target='_blank'
                  rel='noreferrer'
                  className='border-border max-w-[84%] overflow-hidden rounded-lg border'
                >
                  <img
                    src={imageUrl}
                    alt={t('Support image')}
                    loading='lazy'
                    decoding='async'
                    referrerPolicy='no-referrer'
                    className='max-h-80 max-w-full object-contain'
                  />
                </a>
              ) : (
                <div
                  className={cn(
                    'min-w-0 w-max max-w-[84%] rounded-2xl px-3 py-2 text-left text-sm leading-6 break-words whitespace-pre-wrap',
                    isAgent
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 rounded-bl-sm'
                  )}
                >
                  {message.text}
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
      {hasNewMessages && (
        <div className='sticky bottom-0 z-10 flex w-full justify-center pb-1'>
          <Button
            type='button'
            size='sm'
            className='shadow-sm'
            onClick={scrollToLatest}
          >
            <ArrowDown className='size-4' aria-hidden='true' />
            {t('Jump to latest message')}
          </Button>
        </div>
      )}
      <div ref={endRef} aria-hidden='true' />
    </div>
  )
}

function ConversationList({
  conversations,
  selectedID,
  loading,
  error,
  onSelect,
  onRetry,
  hasMore,
  loadingMore,
  loadMoreError,
  onLoadMore,
}: {
  conversations: AdminSupportConversation[]
  selectedID?: string
  loading: boolean
  error: Error | null
  onSelect: (id: string) => void
  onRetry: () => void
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: Error | null
  onLoadMore: () => void
}) {
  const { t } = useTranslation()

  if (loading) return <ConversationListSkeleton />

  if (error) {
    return (
      <div className='p-3'>
        <Alert variant='destructive'>
          <CircleAlert aria-hidden='true' />
          <AlertTitle>{t('Unable to load conversations')}</AlertTitle>
          <AlertDescription className='space-y-3'>
            <p>{t('Unable to load conversations')}</p>
            <Button size='sm' variant='outline' onClick={onRetry}>
              <RefreshCw aria-hidden='true' />
              {t('Try again')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!conversations.length) {
    return (
      <Empty className='min-h-56 rounded-none border-0 px-5'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Inbox aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No support conversations')}</EmptyTitle>
          <EmptyDescription>
            {t('New customer conversations will appear here.')}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div
      className='min-h-0 flex-1 overflow-y-auto p-2'
      data-testid='admin-support-conversation-list'
    >
      <div className='space-y-1'>
        {conversations.map((conversation) => {
          const name = conversationName(conversation)
          const timestamp = formatSupportConversationTime(
            conversation.updatedAt
          )
          return (
            <button
              key={conversation.id}
              type='button'
              className={cn(
                'hover:bg-muted/70 focus-visible:ring-ring flex w-full min-w-0 flex-col gap-1 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2',
                selectedID === conversation.id && 'bg-muted'
              )}
              onClick={() => onSelect(conversation.id)}
              aria-current={selectedID === conversation.id ? 'true' : undefined}
            >
              <div className='flex min-w-0 items-center gap-2'>
                <UserRound
                  className='text-muted-foreground size-4 shrink-0'
                  aria-hidden='true'
                />
                <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                  {name}
                </span>
              </div>
              <div className='flex min-w-0 items-center justify-between gap-3 pl-6'>
                <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
                  {conversation.pageContext?.path ||
                    conversation.pageContext?.title ||
                    t('No page context')}
                </span>
                {timestamp && (
                  <time className='text-muted-foreground shrink-0 text-[11px]'>
                    {timestamp}
                  </time>
                )}
              </div>
            </button>
          )
        })}
      </div>
      {hasMore && (
        <div className='flex flex-col items-center gap-2 px-2 pt-3 pb-1'>
          {loadMoreError && (
            <p className='text-destructive text-center text-xs' role='status'>
              {t('Unable to load more conversations')}
            </p>
          )}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? (
              <LoaderCircle
                className='size-4 animate-spin'
                aria-hidden='true'
              />
            ) : (
              <ChevronDown className='size-4' aria-hidden='true' />
            )}
            {loadingMore
              ? t('Loading more conversations')
              : t('Load more conversations')}
          </Button>
        </div>
      )}
    </div>
  )
}

export function AdminSupportInbox() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [selectedID, setSelectedID] = useState<string>()
  const [draft, setDraft] = useState('')
  const [showListOnMobile, setShowListOnMobile] = useState(true)
  const [attachingImage, setAttachingImage] = useState(false)
  const [imageError, setImageError] = useState<Error | null>(null)
  const draftRef = useRef('')
  const imageInputRef = useRef<HTMLInputElement>(null)

  const conversationsQuery = useInfiniteQuery({
    queryKey: ADMIN_SUPPORT_QUERY_KEY,
    queryFn: ({ pageParam }) => getAdminSupportConversations(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: isAdmin,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  })
  const conversations = mergeConversations(conversationsQuery.data?.pages)
  const activeID =
    selectedID &&
    conversations.some((conversation) => conversation.id === selectedID)
      ? selectedID
      : conversations[0]?.id
  const activeIDRef = useRef(activeID)
  useEffect(() => {
    activeIDRef.current = activeID
  }, [activeID])
  const selectedConversation = conversations.find(
    (conversation) => conversation.id === activeID
  )

  const messagesQuery = useInfiniteQuery({
    queryKey: [ADMIN_SUPPORT_MESSAGES_QUERY_KEY, activeID],
    queryFn: ({ pageParam }) =>
      getAdminSupportMessages(activeID as string, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: isAdmin && Boolean(activeID),
    staleTime: 3_000,
    refetchInterval: activeID ? 10_000 : false,
    retry: 1,
  })
  const messages = mergeMessages(messagesQuery.data?.pages)

  const sendMutation = useMutation({
    mutationFn: ({
      conversationID,
      text,
      kind,
      imageData,
    }: {
      conversationID: string
      text: string
      kind?: 'image'
      imageData?: string
    }) =>
      sendAdminSupportMessage(
        conversationID,
        text,
        kind === 'image' ? { kind: 'image', imageData } : undefined
      ),
    onMutate: async ({ conversationID, text, kind, imageData }) => {
      await queryClient.cancelQueries({
        queryKey: [ADMIN_SUPPORT_MESSAGES_QUERY_KEY, conversationID],
      })
      const queryKey = [
        ADMIN_SUPPORT_MESSAGES_QUERY_KEY,
        conversationID,
      ] as const
      const previous =
        queryClient.getQueryData<InfiniteData<AdminSupportMessagesPage>>(
          queryKey
        )
      const optimisticMessage: AdminSupportMessage = {
        id: createOptimisticMessageID(),
        text: kind === 'image' ? (imageData ?? text) : text,
        author: 'agent',
        kind: kind === 'image' ? 'image' : 'text',
        createdAt: new Date().toISOString(),
      }
      if (previous) {
        queryClient.setQueryData<InfiniteData<AdminSupportMessagesPage>>(
          queryKey,
          {
            ...previous,
            pages: previous.pages.map((page, index) =>
              index === 0
                ? { ...page, messages: [...page.messages, optimisticMessage] }
                : page
            ),
          }
        )
      }
      return { previous, optimisticMessageID: optimisticMessage.id }
    },
    onError: (_error, { conversationID }, context) => {
      if (!context?.previous) return
      queryClient.setQueryData(
        [ADMIN_SUPPORT_MESSAGES_QUERY_KEY, conversationID],
        context.previous
      )
    },
    onSuccess: (message, { conversationID }, context) => {
      const queryKey = [
        ADMIN_SUPPORT_MESSAGES_QUERY_KEY,
        conversationID,
      ] as const
      if (message) {
        queryClient.setQueryData<InfiniteData<AdminSupportMessagesPage>>(
          queryKey,
          (current) => {
            if (!current) return current
            return {
              ...current,
              pages: current.pages.map((page, index) =>
                index !== 0
                  ? page
                  : {
                      ...page,
                      messages: [
                        ...page.messages.filter(
                          (item) => item.id !== context?.optimisticMessageID
                        ),
                        ...(page.messages.some((item) => item.id === message.id)
                          ? []
                          : [message]),
                      ],
                    }
              ),
            }
          }
        )
      } else if (context?.optimisticMessageID) {
        queryClient.setQueryData<InfiniteData<AdminSupportMessagesPage>>(
          queryKey,
          (current) => {
            if (!current) return current
            return {
              ...current,
              pages: current.pages.map((page, index) =>
                index === 0
                  ? {
                      ...page,
                      messages: page.messages.filter(
                        (item) => item.id !== context.optimisticMessageID
                      ),
                    }
                  : page
              ),
            }
          }
        )
      }
      void queryClient.invalidateQueries({ queryKey: ADMIN_SUPPORT_QUERY_KEY })
      void queryClient.invalidateQueries({
        queryKey,
      })
    },
  })

  const selectConversation = (id: string) => {
    setSelectedID(id)
    draftRef.current = ''
    setDraft('')
    if (isMobile) setShowListOnMobile(false)
  }

  const sendReply = () => {
    const text = draftRef.current.trim()
    if (!activeID || !text || attachingImage) return
    setImageError(null)
    draftRef.current = ''
    setDraft('')
    sendMutation.mutate(
      { conversationID: activeID, text },
      {
        onError: () => {
          if (activeIDRef.current !== activeID || draftRef.current.trim()) {
            return
          }
          draftRef.current = text
          setDraft(text)
        },
      }
    )
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sendReply()
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      sendReply()
    }
  }

  const handleImageSelected = (file: File) => {
    if (!activeID || attachingImage || messagesQuery.isLoading) return
    setImageError(null)
    setAttachingImage(true)
    void compressSupportImage(file)
      .then((imageData) => {
        sendMutation.mutate({
          conversationID: activeID,
          text: imageData,
          kind: 'image',
          imageData,
        })
      })
      .catch(() => {
        setImageError(new Error('Unable to upload image'))
      })
      .finally(() => {
        setAttachingImage(false)
      })
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) handleImageSelected(file)
  }

  const refresh = () => {
    void conversationsQuery.refetch()
    if (activeID) void messagesQuery.refetch()
  }

  return (
    <TooltipProvider delay={250}>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          <span className='inline-flex min-w-0 items-center gap-2'>
            <MessageCircle className='size-5 shrink-0' aria-hidden='true' />
            <span className='truncate'>{t('Support Inbox')}</span>
          </span>
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant='outline'
                  size='icon'
                  onClick={refresh}
                  disabled={
                    conversationsQuery.isFetching || messagesQuery.isFetching
                  }
                  aria-label={t('Refresh')}
                />
              }
            >
              <RefreshCw
                className={cn(
                  (conversationsQuery.isFetching || messagesQuery.isFetching) &&
                    'animate-spin'
                )}
                aria-hidden='true'
              />
            </TooltipTrigger>
            <TooltipContent>{t('Refresh')}</TooltipContent>
          </Tooltip>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='bg-card flex h-full min-h-0 overflow-hidden rounded-xl border'>
            <section
              className={cn(
                'h-full min-h-0 w-full flex-col overflow-hidden md:w-80 md:shrink-0 md:border-r',
                isMobile && !showListOnMobile ? 'hidden' : 'flex'
              )}
              aria-label={t('Support conversations')}
            >
              <div className='flex shrink-0 items-center justify-between border-b px-4 py-3'>
                <div className='flex min-w-0 items-center gap-2'>
                  <Inbox
                    className='text-muted-foreground size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <h3 className='truncate text-sm font-semibold'>
                    {t('Conversations')}
                  </h3>
                  {conversations.length > 0 && (
                    <Badge variant='secondary' className='tabular-nums'>
                      {conversations.length}
                    </Badge>
                  )}
                </div>
              </div>
              <ConversationList
                conversations={conversations}
                selectedID={activeID}
                loading={conversationsQuery.isLoading}
                error={
                  conversationsQuery.isError && !conversationsQuery.data
                    ? conversationsQuery.error
                    : null
                }
                onSelect={selectConversation}
                onRetry={() => void conversationsQuery.refetch()}
                hasMore={conversationsQuery.hasNextPage}
                loadingMore={conversationsQuery.isFetchingNextPage}
                loadMoreError={
                  conversationsQuery.isFetchNextPageError
                    ? conversationsQuery.error
                    : null
                }
                onLoadMore={() => void conversationsQuery.fetchNextPage()}
              />
            </section>

            <section
              className={cn(
                'h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
                isMobile && showListOnMobile ? 'hidden' : 'flex'
              )}
              aria-label={t('Selected conversation')}
            >
              {selectedConversation ? (
                <>
                  <header className='flex shrink-0 items-center gap-3 border-b px-4 py-3'>
                    {isMobile && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant='ghost'
                              size='icon'
                              onClick={() => setShowListOnMobile(true)}
                              aria-label={t('Back to conversations')}
                            />
                          }
                        >
                          <ArrowLeft aria-hidden='true' />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('Back to conversations')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <div className='bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg'>
                      <UserRound className='size-4' aria-hidden='true' />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <h3 className='truncate text-sm font-semibold'>
                        {conversationName(selectedConversation)}
                      </h3>
                      <p className='text-muted-foreground truncate text-xs'>
                        {selectedConversation.email ||
                          selectedConversation.username ||
                          `#${selectedConversation.id}`}
                      </p>
                    </div>
                    {selectedConversation.status && (
                      <Badge variant='outline' className='shrink-0'>
                        {selectedConversation.status}
                      </Badge>
                    )}
                  </header>
                  <MessageHistory
                    key={activeID}
                    messages={messages}
                    loading={messagesQuery.isLoading}
                    error={
                      messagesQuery.isError && !messagesQuery.data
                        ? messagesQuery.error
                        : null
                    }
                    onRetry={() => void messagesQuery.refetch()}
                    hasOlderMessages={messagesQuery.hasNextPage}
                    loadingOlderMessages={messagesQuery.isFetchingNextPage}
                    olderMessagesError={
                      messagesQuery.isFetchNextPageError
                        ? messagesQuery.error
                        : null
                    }
                    onLoadOlderMessages={() =>
                      void messagesQuery.fetchNextPage()
                    }
                  />
                  <div className='bg-background shrink-0'>
                    {(sendMutation.error || imageError) && (
                      <div className='px-4 pt-2'>
                        <Alert variant='destructive'>
                          <CircleAlert aria-hidden='true' />
                          <AlertTitle>
                            {t(
                              imageError
                                ? 'Unable to upload image'
                                : 'Unable to send reply'
                            )}
                          </AlertTitle>
                          <AlertDescription>
                            {t(
                              imageError
                                ? 'Unable to upload image'
                                : 'Unable to send reply'
                            )}
                          </AlertDescription>
                        </Alert>
                      </div>
                    )}
                    <form
                      className='border-t p-4'
                      onSubmit={handleSubmit}
                      data-testid='admin-support-composer'
                    >
                      <label className='sr-only' htmlFor='admin-support-reply'>
                        {t('Reply to customer')}
                      </label>
                      <input
                        ref={imageInputRef}
                        type='file'
                        accept='image/*'
                        className='sr-only'
                        tabIndex={-1}
                        disabled={messagesQuery.isLoading || attachingImage}
                        aria-label={t('Attach image')}
                        onChange={handleImageChange}
                      />
                      <div className='relative'>
                        <Textarea
                          id='admin-support-reply'
                          value={draft}
                          onChange={(event) => {
                            draftRef.current = event.target.value
                            setDraft(event.target.value)
                          }}
                          onKeyDown={handleComposerKeyDown}
                          placeholder={t('Reply to customer')}
                          maxLength={MAX_REPLY_LENGTH}
                          rows={3}
                          disabled={messagesQuery.isLoading}
                          className='min-h-22 resize-none pr-24'
                          aria-describedby='admin-support-reply-hint'
                        />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type='button'
                                size='icon'
                                variant='ghost'
                                className='absolute right-12 bottom-2'
                                disabled={
                                  messagesQuery.isLoading || attachingImage
                                }
                                aria-label={t('Attach image')}
                                onClick={() => imageInputRef.current?.click()}
                              />
                            }
                          >
                            {attachingImage ? (
                              <LoaderCircle
                                className='animate-spin'
                                aria-hidden='true'
                              />
                            ) : (
                              <ImagePlus aria-hidden='true' />
                            )}
                          </TooltipTrigger>
                          <TooltipContent>{t('Attach image')}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type='submit'
                                size='icon'
                                className='absolute right-2 bottom-2'
                                disabled={
                                  !draft.trim() ||
                                  messagesQuery.isLoading ||
                                  attachingImage
                                }
                                aria-label={t('Send reply')}
                              />
                            }
                          >
                            <SendHorizontal aria-hidden='true' />
                          </TooltipTrigger>
                          <TooltipContent>{t('Send reply')}</TooltipContent>
                        </Tooltip>
                      </div>
                      <div
                        id='admin-support-reply-hint'
                        className='text-muted-foreground mt-2 flex justify-between text-xs'
                      >
                        <span>
                          {t('Press Enter to send, Shift+Enter for a new line')}
                        </span>
                        <span className='tabular-nums'>
                          {draft.length}/{MAX_REPLY_LENGTH}
                        </span>
                      </div>
                    </form>
                  </div>
                </>
              ) : (
                <Empty className='min-h-0 flex-1 rounded-none border-0'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <MessageCircle aria-hidden='true' />
                    </EmptyMedia>
                    <EmptyTitle>{t('Select a conversation')}</EmptyTitle>
                    <EmptyDescription>
                      {t(
                        'Choose a customer conversation to view its messages.'
                      )}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    </TooltipProvider>
  )
}
