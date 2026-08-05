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
import { ExternalLink, Globe2, LoaderCircle, ShieldAlert } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { getRegionalRestrictionStatus, verifyApiKeyPassword } from '../api'
import type {
  ApiKeyCreationAuthorization,
  ApiKeyPasswordProof,
  RegionalRestrictionStatus,
} from '../types'

type RegionalRestrictionGateMode =
  | 'checking'
  | 'allowed'
  | 'confirmation'
  | 'blocked'

type RegionalRestrictionGateProps = {
  children: (controls: {
    checkApiKeyCreation: () => Promise<ApiKeyCreationAuthorization>
  }) => ReactNode
}

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
    passwordLabel: 'Account password',
    passwordPlaceholder: 'Enter your login password',
    passwordHelp:
      'Enter the password for the currently signed-in account to continue.',
    confirmButton: 'Verify and Continue',
    backButton: 'Back',
    storageNotice:
      'Your password is verified securely by the server and is never stored in this browser.',
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
    passwordLabel: '账号登录密码',
    passwordPlaceholder: '请输入当前账号的登录密码',
    passwordHelp: '请输入当前登录账号的密码，验证成功后方可继续。',
    confirmButton: '验证并继续',
    backButton: '返回',
    storageNotice: '密码仅发送到服务端进行安全校验，不会保存在浏览器中。',
    translateAriaLabel: '显示英文原文',
  },
} as const

const REGIONAL_RESTRICTION_LINKS = [
  { key: 'terms', href: '/legal/terms' },
  { key: 'privacy', href: '/legal/privacy' },
  { key: 'acceptableUse', href: '/legal/acceptable-use' },
  { key: 'refund', href: '/legal/refund' },
  { key: 'restrictedRegions', href: '/legal/restricted-regions' },
] as const

function isPasswordProofActive(proof: ApiKeyPasswordProof | null): boolean {
  return Boolean(
    proof &&
    Number.isFinite(proof.expires_at) &&
    proof.expires_at * 1000 > Date.now() + 5_000
  )
}

function RegionalRestrictionDialog(props: {
  mode: 'confirmation' | 'blocked'
  status: RegionalRestrictionStatus | null
  onConfirm: (proof: ApiKeyPasswordProof) => void
}) {
  const [password, setPassword] = useState('')
  const [verificationError, setVerificationError] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [language, setLanguage] = useState<'en' | 'zh'>('en')
  const isBlocked = props.mode === 'blocked'
  const copy = REGIONAL_RESTRICTION_COPY[language]

  useEffect(() => {
    setPassword('')
    setVerificationError('')
    setIsVerifying(false)
  }, [props.mode, props.status])

  const handleConfirm = async () => {
    if (!password || isVerifying) return

    setVerificationError('')
    setIsVerifying(true)
    try {
      const proof = await verifyApiKeyPassword(password)
      setPassword('')
      props.onConfirm(proof)
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : 'Password verification failed'
      )
    } finally {
      setIsVerifying(false)
    }
  }

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
            <div
              className='grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3'
              aria-label={copy.bullets[2]}
            >
              {REGIONAL_RESTRICTION_LINKS.map((link) => (
                <a
                  key={link.key}
                  href={link.href}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='border-border/70 bg-muted/30 text-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-primary flex min-h-10 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors'
                >
                  <span>{copy.links[link.key]}</span>
                  <ExternalLink
                    className='text-muted-foreground size-3.5 shrink-0'
                    aria-hidden='true'
                  />
                </a>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!isBlocked && (
          <div className='border-border/70 bg-muted/30 mx-4 rounded-lg border p-3 sm:mx-6 sm:p-4'>
            <div className='space-y-2'>
              <Label htmlFor='regional-restriction-password'>
                {copy.passwordLabel}
              </Label>
              <Input
                id='regional-restriction-password'
                type='password'
                autoComplete='current-password'
                value={password}
                placeholder={copy.passwordPlaceholder}
                disabled={isVerifying}
                aria-invalid={verificationError ? true : undefined}
                aria-describedby='regional-restriction-password-help'
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void handleConfirm()
                }}
              />
              <p
                id='regional-restriction-password-help'
                className='text-muted-foreground text-xs leading-5'
              >
                {copy.passwordHelp}
              </p>
              {verificationError && (
                <p className='text-destructive text-sm' role='alert'>
                  {verificationError}
                </p>
              )}
            </div>
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
              disabled={!password || isVerifying}
              onClick={() => void handleConfirm()}
            >
              {isVerifying && (
                <LoaderCircle
                  className='size-4 animate-spin'
                  aria-hidden='true'
                />
              )}
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
  const [passwordProof, setPasswordProof] =
    useState<ApiKeyPasswordProof | null>(null)

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
        if (nextStatus.enabled && nextStatus.confirmation_required) {
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

  const checkApiKeyCreation =
    useCallback(async (): Promise<ApiKeyCreationAuthorization> => {
      try {
        const nextStatus = await getRegionalRestrictionStatus('api_key_create')
        if (nextStatus.blocked) {
          setStatus(nextStatus)
          setMode('blocked')
          return { allowed: false }
        }

        if (!nextStatus.confirmation_required) return { allowed: true }
        if (isPasswordProofActive(passwordProof)) {
          return {
            allowed: true,
            securityProof: passwordProof?.proof_token,
          }
        }

        setStatus(nextStatus)
        setPasswordProof(null)
        setMode('confirmation')
        return { allowed: false }
      } catch {
        return { allowed: true }
      }
    }, [passwordProof])

  const handleConfirm = (proof: ApiKeyPasswordProof) => {
    setPasswordProof(proof)
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
