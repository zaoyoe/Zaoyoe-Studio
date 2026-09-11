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

import { ImagePlus, LoaderCircle, SendHorizontal } from 'lucide-react'
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useRef,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const SUPPORT_MESSAGE_MAX_LENGTH = 4000

type SupportComposerProps = {
  value: string
  disabled: boolean
  sending: boolean
  attachingImage?: boolean
  onTextareaMount: (element: HTMLTextAreaElement | null) => void
  onValueChange: (value: string) => void
  onSubmit: () => void
  onImageSelected?: (file: File) => void
}

export function SupportComposer({
  value,
  disabled,
  sending,
  attachingImage = false,
  onTextareaMount,
  onValueChange,
  onSubmit,
  onImageSelected,
}: SupportComposerProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canSubmit =
    value.trim().length > 0 && !disabled && !sending && !attachingImage
  const canAttachImage =
    Boolean(onImageSelected) && !disabled && !sending && !attachingImage

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canSubmit) onSubmit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== 'Enter' ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return
    }
    event.preventDefault()
    if (canSubmit) onSubmit()
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file && canAttachImage) onImageSelected?.(file)
  }

  return (
    <form className='bg-background shrink-0 border-t p-4' onSubmit={submit}>
      <label className='sr-only' htmlFor='support-message'>
        {t('Message support')}
      </label>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        className='sr-only'
        tabIndex={-1}
        disabled={!canAttachImage}
        aria-label={t('Attach image')}
        onChange={handleImageChange}
      />
      <div className='relative'>
        <Textarea
          ref={onTextareaMount}
          id='support-message'
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('Describe what you need help with...')}
          disabled={disabled || sending}
          maxLength={SUPPORT_MESSAGE_MAX_LENGTH}
          rows={3}
          className='min-h-22 resize-none pr-24'
          aria-describedby='support-message-hint'
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type='button'
                size='icon'
                variant='ghost'
                className='absolute right-12 bottom-2'
                disabled={!canAttachImage}
                aria-label={t('Attach image')}
                onClick={() => fileInputRef.current?.click()}
              />
            }
          >
            {attachingImage ? (
              <LoaderCircle className='animate-spin' aria-hidden='true' />
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
                disabled={!canSubmit}
                aria-label={t('Send message')}
              />
            }
          >
            {sending ? (
              <LoaderCircle className='animate-spin' aria-hidden='true' />
            ) : (
              <SendHorizontal aria-hidden='true' />
            )}
          </TooltipTrigger>
          <TooltipContent>{t('Send message')}</TooltipContent>
        </Tooltip>
      </div>
      <div
        id='support-message-hint'
        className='text-muted-foreground mt-2 flex items-center justify-between gap-3 text-xs'
      >
        <span>{t('Press Enter to send, Shift+Enter for a new line')}</span>
        <span className='tabular-nums'>
          {value.length}/{SUPPORT_MESSAGE_MAX_LENGTH}
        </span>
      </div>
    </form>
  )
}
