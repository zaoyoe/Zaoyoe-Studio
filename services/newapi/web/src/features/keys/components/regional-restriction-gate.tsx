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
import { Globe2, LoaderCircle, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

import { getRegionalRestrictionStatus } from '../api'
import type { RegionalRestrictionStatus } from '../types'

type RegionalRestrictionGateMode =
  | 'checking'
  | 'allowed'
  | 'confirmation'
  | 'blocked'

type RegionalRestrictionGateProps = {
  children: (controls: {
    checkApiKeyCreation: () => Promise<boolean>
  }) => ReactNode
}

type StoredConfirmation = {
  revision?: string
  accepted_at?: string
}

const CONFIRMATION_STORAGE_PREFIX = 'newapi.regional-restriction-confirmed:'

const REGIONAL_RESTRICTION_COPY = {
  en: {
    title: 'API Key Use Confirmation',
    description:
      'Before creating or managing API keys, please confirm that you will not use this service from a restricted region or for prohibited, abusive, or unlawful activity.',
    blockedNotice:
      'This request is from a restricted region, so API key creation and management are not available.',
    bullets: [
      'The service is not offered to users located in restricted regions, including mainland China.',
      'You must not evade regional, payment, provider, or legal restrictions.',
      'You must comply with the Terms, Privacy Policy, Acceptable Use Policy, Refund and Suspension Policy, and Restricted Regions Notice.',
    ],
    links: {
      terms: 'Terms',
      privacy: 'Privacy',
      acceptableUse: 'Acceptable Use',
      refund: 'Refund',
      restrictedRegions: 'Restricted Regions',
    },
    confirmation:
      'I confirm that I am eligible to continue and will not use this service from a restricted region or for prohibited activity.',
    confirmButton: 'I Confirm',
    backButton: 'Back',
    storageNotice:
      'This soft confirmation is stored only in this browser. It does not create a server-side confirmation record or additional IP log.',
    translateAriaLabel: 'Show Chinese translation',
  },
  zh: {
    title: 'API 密钥使用确认',
    description:
      '在创建或管理 API 密钥前，请确认你不会在受限制地区使用本服务，也不会将本服务用于被禁止、滥用或违法的活动。',
    blockedNotice:
      '当前请求所在地区属于受限制地区，因此无法继续创建或管理 API 密钥。',
    bullets: [
      '本服务不向位于受限制地区的用户提供，包括中国大陆。',
      '你不得规避地区、支付、服务提供方或法律限制。',
      '你必须遵守服务条款、隐私政策、可接受使用政策、退款与暂停政策，以及受限制地区说明。',
    ],
    links: {
      terms: '服务条款',
      privacy: '隐私政策',
      acceptableUse: '可接受使用',
      refund: '退款政策',
      restrictedRegions: '受限制地区',
    },
    confirmation:
      '我确认自己符合继续使用资格，并且不会在受限制地区使用本服务，也不会用于被禁止的活动。',
    confirmButton: '我确认',
    backButton: '返回',
    storageNotice:
      '此软确认仅保存在当前浏览器中，不会创建服务器端确认记录，也不会产生额外 IP 日志。',
    translateAriaLabel: '显示英文原文',
  },
} as const

const REGIONAL_RESTRICTION_LINKS = [
  { key: 'terms', href: '/user-agreement' },
  { key: 'privacy', href: '/privacy-policy' },
  {
    key: 'acceptableUse',
    href: 'https://www.fatherkey.com/legal/acceptable-use',
  },
  { key: 'refund', href: 'https://www.fatherkey.com/legal/refund' },
  {
    key: 'restrictedRegions',
    href: 'https://www.fatherkey.com/legal/restricted-regions',
  },
] as const

function confirmationStorageKey(status: RegionalRestrictionStatus): string {
  return `${CONFIRMATION_STORAGE_PREFIX}${status.revision || 'default'}`
}

function hasAcceptedConfirmation(status: RegionalRestrictionStatus): boolean {
  if (!status.confirmation_required) return true
  if (status.confirmation_frequency === 'always') return false

  try {
    const raw = window.localStorage.getItem(confirmationStorageKey(status))
    if (!raw) return false

    const stored = JSON.parse(raw) as StoredConfirmation
    if (stored.revision !== status.revision) return false
    if (status.confirmation_frequency !== 'interval') return true

    const acceptedAt = Date.parse(stored.accepted_at || '')
    const intervalHours = Math.max(
      1,
      Number(status.confirmation_interval_hours) || 24
    )
    return (
      Number.isFinite(acceptedAt) &&
      Date.now() - acceptedAt < intervalHours * 60 * 60 * 1000
    )
  } catch {
    return false
  }
}

function storeConfirmation(status: RegionalRestrictionStatus): void {
  if (status.confirmation_frequency === 'always') return

  try {
    window.localStorage.setItem(
      confirmationStorageKey(status),
      JSON.stringify({
        revision: status.revision,
        accepted_at: new Date().toISOString(),
      } satisfies StoredConfirmation)
    )
  } catch {
    // Confirmation remains valid for the current page visit.
  }
}

function RegionalRestrictionDialog(props: {
  mode: 'confirmation' | 'blocked'
  status: RegionalRestrictionStatus | null
  onConfirm: () => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const [language, setLanguage] = useState<'en' | 'zh'>('en')
  const isBlocked = props.mode === 'blocked'
  const copy = REGIONAL_RESTRICTION_COPY[language]

  useEffect(() => {
    setConfirmed(false)
  }, [props.mode, props.status])

  return (
    <AlertDialog open>
      <AlertDialogContent className='max-h-[min(90dvh,48rem)] w-[calc(100vw-1.5rem)] !max-w-2xl overflow-y-auto p-0 sm:w-[min(42rem,calc(100vw-3rem))]'>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground hover:text-foreground absolute top-4 right-4 z-10'
          aria-label={copy.translateAriaLabel}
          aria-pressed={language === 'zh'}
          title={copy.translateAriaLabel}
          onClick={() =>
            setLanguage((current) => (current === 'en' ? 'zh' : 'en'))
          }
        >
          <Globe2 aria-hidden='true' />
        </Button>
        <AlertDialogHeader className='items-start px-4 pt-5 text-left sm:px-6 sm:pt-6'>
          <AlertDialogMedia>
            {isBlocked ? (
              <ShieldAlert aria-hidden='true' />
            ) : (
              <Globe2 aria-hidden='true' />
            )}
          </AlertDialogMedia>
          <AlertDialogTitle className='pr-10 text-left'>
            {copy.title}
          </AlertDialogTitle>
          <AlertDialogDescription
            render={<div />}
            className='space-y-3 text-left leading-6'
          >
            <p>{isBlocked ? copy.blockedNotice : copy.description}</p>
            <ul className='text-foreground list-disc space-y-2 pl-5'>
              {copy.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
            <div className='flex flex-wrap gap-x-4 gap-y-2 font-medium'>
              {REGIONAL_RESTRICTION_LINKS.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-primary hover:text-primary/80 underline-offset-4 hover:underline'
                >
                  {copy.links[link.key]}
                </a>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!isBlocked && (
          <div className='border-border/70 bg-muted/30 mx-4 flex items-start gap-3 rounded-lg border p-3 sm:mx-6 sm:p-4'>
            <Checkbox
              id='regional-restriction-confirmation'
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              className='mt-0.5'
            />
            <Label
              htmlFor='regional-restriction-confirmation'
              className='text-sm leading-5 font-normal'
            >
              {copy.confirmation}
            </Label>
          </div>
        )}

        {!isBlocked && (
          <p className='text-muted-foreground border-border/70 mx-4 border-t pt-4 text-xs leading-5 sm:mx-6'>
            {copy.storageNotice}
          </p>
        )}

        <AlertDialogFooter className='mx-0 mt-1 mb-0 px-4 sm:px-6'>
          <Button variant='outline' render={<a href='/dashboard/overview' />}>
            {copy.backButton}
          </Button>
          {!isBlocked && (
            <Button
              type='button'
              disabled={!confirmed}
              onClick={props.onConfirm}
            >
              {copy.confirmButton}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RegionalRestrictionLoading() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('API Keys')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div
          className='text-muted-foreground flex min-h-40 items-center justify-center gap-2 text-sm'
          role='status'
          aria-live='polite'
        >
          <LoaderCircle className='size-4 animate-spin' aria-hidden='true' />
          {t('Checking regional availability...')}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

export function RegionalRestrictionGate(props: RegionalRestrictionGateProps) {
  const [mode, setMode] = useState<RegionalRestrictionGateMode>('checking')
  const [status, setStatus] = useState<RegionalRestrictionStatus | null>(null)

  useEffect(() => {
    let active = true

    void getRegionalRestrictionStatus('api_key_page')
      .then((nextStatus) => {
        if (!active) return
        setStatus(nextStatus)

        if (nextStatus.blocked) {
          setMode('blocked')
          return
        }
        if (
          nextStatus.enabled &&
          nextStatus.confirmation_required &&
          !hasAcceptedConfirmation(nextStatus)
        ) {
          setMode('confirmation')
          return
        }
        setMode('allowed')
      })
      .catch(() => {
        if (active) setMode('allowed')
      })

    return () => {
      active = false
    }
  }, [])

  const checkApiKeyCreation = useCallback(async (): Promise<boolean> => {
    try {
      const nextStatus = await getRegionalRestrictionStatus('api_key_create')
      if (!nextStatus.blocked) return true

      setStatus(nextStatus)
      setMode('blocked')
      return false
    } catch {
      return true
    }
  }, [])

  const handleConfirm = () => {
    if (status) storeConfirmation(status)
    setMode('allowed')
  }

  if (mode === 'checking') return <RegionalRestrictionLoading />

  if (mode === 'confirmation' || mode === 'blocked') {
    return (
      <RegionalRestrictionDialog
        mode={mode}
        status={status}
        onConfirm={handleConfirm}
      />
    )
  }

  return props.children({ checkApiKeyCreation })
}
