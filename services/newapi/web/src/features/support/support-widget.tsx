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

import { useLocation, useNavigate } from '@tanstack/react-router'
import {
  CircleAlert,
  LogIn,
  MessageCircleMore,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { useAuthStore } from '@/stores/auth-store'

import { SupportApiError } from './api'
import { SupportComposer } from './components/support-composer'
import { SupportMessageList } from './components/support-message-list'
import { useSupportConversation } from './hooks/use-support-conversation'
import { getSupportPageContext } from './lib/page-context'

const SUGGESTION_KEYS = [
  'I need help with an API key',
  'I have a quota or usage question',
  'A model or channel request failed',
  'I need billing or payment help',
  'I need help with my account or security',
  'I need to contact a person',
] as const

function createClientMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function errorMessage(
  error: Error | null,
  t: (key: string) => string,
  fallbackKey: 'Unable to load support' | 'Unable to send support message'
): string | null {
  if (!error) return null

  if (error instanceof SupportApiError) {
    switch (error.code) {
      case 'AUTH_SESSION_REQUIRED':
        return t('Your dashboard session is required to contact support.')
      case 'SUPPORT_GATEWAY_REJECTED':
        return t('Support could not process this request. Please try again.')
      case 'SUPPORT_GATEWAY_UNAVAILABLE':
        return t(
          'Support service is temporarily unavailable. Please try again shortly.'
        )
      default:
        return t(error.fallbackKey)
    }
  }

  return t(fallbackKey)
}

export function SupportWidget() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const user = useAuthStore((state) => state.auth.user)
  const bootstrapState = useAuthStore((state) => state.auth.bootstrapState)
  const isMobile = useIsMobile()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftClientMessageIdRef = useRef<string | null>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const page = useMemo(
    () =>
      getSupportPageContext(
        pathname,
        typeof document === 'undefined' ? undefined : document.title
      ),
    [pathname]
  )
  const authenticated = Boolean(user) && bootstrapState === 'complete'
  const conversation = useSupportConversation(
    open,
    authenticated,
    page,
    user?.id
  )
  const supportError = errorMessage(
    conversation.error,
    t,
    'Unable to load support'
  )
  const sendError = errorMessage(
    conversation.sendError,
    t,
    'Unable to send support message'
  )
  const canShowSuggestions =
    !conversation.isLoading &&
    !supportError &&
    conversation.messages.length === 0

  const setTextareaElement = useCallback(
    (element: HTMLTextAreaElement | null) => {
      textareaRef.current = element
    },
    []
  )

  const resetDraftClientMessageId = useCallback(() => {
    draftClientMessageIdRef.current = null
  }, [])

  const updateDraft = (value: string) => {
    setDraft(value)
    resetDraftClientMessageId()
  }

  const handleSignIn = () => {
    setOpen(false)
    void navigate({ to: '/sign-in', search: { redirect: pathname } })
  }

  const handleSuggestion = (suggestion: string) => {
    updateDraft(suggestion)
    globalThis.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || conversation.isSending || supportError) return

    const clientMessageId =
      draftClientMessageIdRef.current ?? createClientMessageId()
    draftClientMessageIdRef.current = clientMessageId

    try {
      await conversation.send({
        text,
        clientMessageId,
        page,
      })
      setDraft('')
      resetDraftClientMessageId()
    } catch {
      // The failed draft remains in the composer so the user can retry it.
    }
  }

  return (
    <TooltipProvider delay={250}>
      <Sheet open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <SheetTrigger
                render={
                  <Button
                    size='icon-lg'
                    className='fixed right-4 bottom-4 z-40 rounded-full shadow-lg sm:right-6 sm:bottom-6'
                    aria-label={t('Contact support')}
                  />
                }
              />
            }
          >
            <MessageCircleMore className='size-5' aria-hidden='true' />
          </TooltipTrigger>
          <TooltipContent>{t('Contact support')}</TooltipContent>
        </Tooltip>

        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className='h-[min(82dvh,44rem)] w-full gap-0 sm:h-full sm:max-w-md'
        >
          <SheetHeader className='border-b px-4 py-4 pr-12'>
            <div className='flex items-center gap-3'>
              <div className='bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg'>
                <MessageCircleMore className='size-4.5' aria-hidden='true' />
              </div>
              <div className='min-w-0'>
                <SheetTitle className='flex items-center gap-2'>
                  {t('Support')}
                  {conversation.unreadCount > 0 && (
                    <Badge variant='secondary' className='tabular-nums'>
                      {conversation.unreadCount}
                    </Badge>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {authenticated
                    ? t(
                        'Ask about billing, API keys, usage, or a request error.'
                      )
                    : t(
                        'Sign in to keep your support history with your account.'
                      )}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {!authenticated ? (
            <div className='flex flex-1 flex-col items-center justify-center gap-4 px-8 py-10 text-center'>
              <div className='bg-muted flex size-10 items-center justify-center rounded-lg'>
                <ShieldCheck
                  className='text-muted-foreground size-5'
                  aria-hidden='true'
                />
              </div>
              <div className='space-y-1'>
                <p className='text-foreground text-sm font-medium'>
                  {t('Sign in to contact support')}
                </p>
                <p className='text-muted-foreground text-sm leading-5'>
                  {t(
                    'We use your dashboard session to protect your conversation.'
                  )}
                </p>
              </div>
              <Button onClick={handleSignIn}>
                <LogIn aria-hidden='true' />
                {t('Sign in')}
              </Button>
            </div>
          ) : (
            <>
              <div className='flex min-h-0 flex-1 flex-col'>
                <SupportMessageList
                  messages={conversation.messages}
                  loading={conversation.isLoading}
                  error={conversation.error}
                  errorMessage={supportError}
                  hasOlderMessages={conversation.hasOlderMessages}
                  loadingOlderMessages={conversation.isLoadingOlderMessages}
                  olderMessagesError={conversation.olderMessagesError}
                  onLoadOlderMessages={() =>
                    void conversation.loadOlderMessages()
                  }
                  onRetry={conversation.retry}
                />
                {canShowSuggestions && (
                  <section
                    className='border-t px-4 py-3'
                    aria-label={t('Suggested support topics')}
                  >
                    <p className='text-muted-foreground mb-2 text-xs font-medium'>
                      {t('Suggested topics')}
                    </p>
                    <div className='flex max-h-28 flex-wrap gap-2 overflow-y-auto pr-1'>
                      {SUGGESTION_KEYS.map((suggestion) => (
                        <Button
                          key={suggestion}
                          type='button'
                          size='sm'
                          variant='outline'
                          className='h-auto min-h-7 max-w-full justify-start py-1.5 text-left whitespace-normal'
                          onClick={() => handleSuggestion(t(suggestion))}
                        >
                          {t(suggestion)}
                        </Button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
              {sendError && (
                <div className='px-4 pt-3'>
                  <Alert variant='destructive'>
                    <CircleAlert aria-hidden='true' />
                    <AlertTitle>{t('Message was not sent')}</AlertTitle>
                    <AlertDescription>{sendError}</AlertDescription>
                  </Alert>
                </div>
              )}
              <SupportComposer
                value={draft}
                onValueChange={updateDraft}
                onSubmit={() => void handleSend()}
                onTextareaMount={setTextareaElement}
                sending={conversation.isSending}
                disabled={conversation.isLoading || Boolean(supportError)}
              />
            </>
          )}
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  )
}
