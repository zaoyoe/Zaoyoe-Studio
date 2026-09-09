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
  ArrowDown,
  ChevronUp,
  CircleAlert,
  LoaderCircle,
  MessageCircleMore,
  RefreshCw,
} from 'lucide-react'
import {
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { SupportMessage } from '../types'

type SupportMessageListProps = {
  messages: SupportMessage[]
  loading: boolean
  error?: Error | null
  errorMessage?: string | null
  hasOlderMessages: boolean
  loadingOlderMessages: boolean
  olderMessagesError?: Error | null
  onLoadOlderMessages: () => void
  onRetry: () => void
}

function messageAuthorLabel(
  author: SupportMessage['author'],
  t: (key: string) => string
): string {
  if (author === 'agent') return t('Support team')
  if (author === 'system') return t('Support')
  return t('You')
}

function formatMessageTime(value: string): string | null {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return null

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function getSupportImageUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function SupportMessageList({
  messages,
  loading,
  error,
  errorMessage,
  hasOlderMessages,
  loadingOlderMessages,
  olderMessagesError,
  onLoadOlderMessages,
  onRetry,
}: SupportMessageListProps) {
  const { t } = useTranslation()
  const messageListRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const didScrollInitialMessagesRef = useRef(false)
  const shouldStickToBottomRef = useRef(true)
  const olderMessagesScrollHeightRef = useRef<number | null>(null)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const latestMessageID = messages.at(-1)?.id

  const scrollToLatest = useCallback(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
    shouldStickToBottomRef.current = true
    setHasNewMessages(false)
  }, [])

  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 48
    shouldStickToBottomRef.current = isNearBottom
    if (isNearBottom) setHasNewMessages(false)
  }, [])

  const handleLoadOlderMessages = useCallback(() => {
    olderMessagesScrollHeightRef.current =
      messageListRef.current?.scrollHeight ?? null
    onLoadOlderMessages()
  }, [onLoadOlderMessages])

  useLayoutEffect(() => {
    const list = messageListRef.current
    const previousHeight = olderMessagesScrollHeightRef.current
    if (!list || previousHeight === null || loadingOlderMessages) return

    list.scrollTop += Math.max(0, list.scrollHeight - previousHeight)
    olderMessagesScrollHeightRef.current = null
  }, [loadingOlderMessages, messages.length])

  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      if (!latestMessageID || loading) {
        if (!latestMessageID) {
          didScrollInitialMessagesRef.current = false
          setHasNewMessages(false)
        }
        return
      }

      if (
        !didScrollInitialMessagesRef.current ||
        shouldStickToBottomRef.current
      ) {
        scrollToLatest()
        didScrollInitialMessagesRef.current = true
        return
      }

      setHasNewMessages(true)
    })
    return () => globalThis.cancelAnimationFrame(frame)
  }, [latestMessageID, loading, scrollToLatest])

  if (loading) {
    return (
      <div
        className='flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5'
        aria-busy='true'
        aria-label={t('Loading support conversation')}
      >
        <div className='flex max-w-[78%] flex-col gap-2'>
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
      <div className='flex flex-1 items-center px-4 py-5'>
        <Alert variant='destructive'>
          <CircleAlert aria-hidden='true' />
          <AlertTitle>{t('Unable to load support')}</AlertTitle>
          <AlertDescription className='space-y-3'>
            <p>{errorMessage ?? t('Unable to load support')}</p>
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
      <div className='text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 px-8 py-10 text-center'>
        <div className='bg-muted flex size-10 items-center justify-center rounded-lg'>
          <MessageCircleMore className='size-5' aria-hidden='true' />
        </div>
        <div className='space-y-1'>
          <p className='text-foreground text-sm font-medium'>
            {t('Start a support conversation')}
          </p>
          <p className='text-sm leading-5'>
            {t('Choose a topic or describe what happened.')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className='flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-5'
      role='log'
      aria-live='polite'
      aria-relevant='additions text'
      aria-label={t('Support conversation')}
      data-testid='support-message-list'
      ref={messageListRef}
      onScroll={handleScroll}
    >
      {hasOlderMessages && (
        <div className='flex flex-col items-center gap-2'>
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
      {messages.map((message) => {
        const isUser = message.author === 'user'
        const isSystem = message.author === 'system'
        const imageUrl =
          message.kind === 'image' && message.author === 'agent'
            ? getSupportImageUrl(message.text)
            : null
        const formattedTime = formatMessageTime(message.createdAt)

        return (
          <article
            key={message.id}
            className={cn('flex flex-col gap-1', isUser && 'items-end')}
          >
            <div
              className={cn(
                'flex items-center gap-2 text-xs',
                isUser && 'flex-row-reverse'
              )}
            >
              <span className='text-muted-foreground'>
                {messageAuthorLabel(message.author, t)}
              </span>
              {formattedTime && (
                <time
                  className='text-muted-foreground/75 tabular-nums'
                  dateTime={message.createdAt}
                >
                  {formattedTime}
                </time>
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
              <p
                className={cn(
                  'max-w-[84%] rounded-lg px-3 py-2 text-sm leading-5 break-words whitespace-pre-wrap',
                  isUser && 'bg-primary text-primary-foreground rounded-tr-sm',
                  !isUser &&
                    !isSystem &&
                    'bg-muted text-foreground rounded-tl-sm',
                  isSystem &&
                    'border-border bg-background text-muted-foreground rounded-tl-sm border'
                )}
              >
                {message.text}
              </p>
            )}
          </article>
        )
      })}
      {hasNewMessages && (
        <div className='sticky bottom-0 z-10 flex justify-center pb-1'>
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
