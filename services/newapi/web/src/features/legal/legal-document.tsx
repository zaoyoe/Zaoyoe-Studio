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
import { Link } from '@tanstack/react-router'
import { ExternalLink, FileText, FileWarning } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { isHttpUrl, isLikelyHtml } from '@/lib/content-format'

import { getLegalDocument } from './api'
import type { LegalDocumentId, LegalDocumentResponse } from './types'

const LEGAL_DOCUMENTS = [
  { id: 'terms', titleKey: 'Terms of Service' },
  { id: 'privacy', titleKey: 'Privacy Policy' },
  { id: 'acceptable-use', titleKey: 'Acceptable Use Policy' },
  { id: 'refund', titleKey: 'Refund Policy' },
  { id: 'restricted-regions', titleKey: 'Restricted Regions' },
] as const satisfies ReadonlyArray<{
  id: LegalDocumentId
  titleKey: string
}>

type LegalDocumentProps = {
  documentId: LegalDocumentId
  title: string
  queryKey: string
  fetchDocument: () => Promise<LegalDocumentResponse>
  emptyMessage: string
}

function LegalDocumentNavigation(props: { activeDocumentId: LegalDocumentId }) {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('Legal documents')}
      className='border-border/70 bg-muted/35 mb-5 flex gap-1 overflow-x-auto rounded-xl border p-1.5 shadow-sm sm:mb-7'
    >
      {LEGAL_DOCUMENTS.map((document) => {
        const isActive = document.id === props.activeDocumentId
        return (
          <Link
            key={document.id}
            to='/legal/$documentId'
            params={{ documentId: document.id }}
            aria-current={isActive ? 'page' : undefined}
            className={
              isActive
                ? 'bg-background text-foreground ring-border/60 shrink-0 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm ring-1'
                : 'text-muted-foreground hover:bg-background/70 hover:text-foreground shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors'
            }
          >
            {t(document.titleKey)}
          </Link>
        )
      })}
    </nav>
  )
}

function LegalPageFrame(props: {
  activeDocumentId: LegalDocumentId
  children: React.ReactNode
}) {
  return (
    <PublicLayout>
      <div className='mx-auto max-w-5xl py-6 sm:py-10'>
        <LegalDocumentNavigation activeDocumentId={props.activeDocumentId} />
        {props.children}
      </div>
    </PublicLayout>
  )
}

export function LegalDocumentArticle(props: {
  title: string
  content: string
  contentIsHtml: boolean
}) {
  return (
    <article className='border-border/70 bg-card overflow-hidden rounded-2xl border shadow-sm'>
      <header className='border-border/70 bg-muted/20 border-b px-5 py-6 sm:px-8 sm:py-8'>
        <div className='flex items-center gap-4'>
          <div className='bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl'>
            <FileText className='size-5' aria-hidden='true' />
          </div>
          <h1 className='text-2xl font-semibold tracking-tight sm:text-3xl'>
            {props.title}
          </h1>
        </div>
      </header>

      <div className='mx-auto max-w-4xl px-5 py-7 sm:px-10 sm:py-10 lg:px-14'>
        <RichContent
          mode={props.contentIsHtml ? 'html' : 'markdown'}
          htmlVariant={props.contentIsHtml ? 'isolated' : undefined}
          breaks={!props.contentIsHtml}
          content={props.content}
          className='prose-neutral dark:prose-invert max-w-none [&_h1]:border-b [&_h1]:pb-3 [&_h2]:border-b [&_h2]:pb-3 [&_h2]:tracking-tight [&_h3]:mt-8 [&_h3]:tracking-tight [&_hr]:my-10 [&_li]:my-2 [&_li]:leading-7 [&_p]:my-4 [&_p]:text-[0.98rem] [&_p]:leading-8'
        />
      </div>
    </article>
  )
}

export function LegalDocument(props: LegalDocumentProps) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: [props.queryKey],
    queryFn: props.fetchDocument,
    staleTime: 10 * 60 * 1000,
  })

  const rawContent = data?.data?.trim() ?? ''
  const hasContent = rawContent.length > 0
  const isUrl = hasContent && isHttpUrl(rawContent)
  const contentIsHtml = hasContent && isLikelyHtml(rawContent)
  const success = data?.success ?? false

  useEffect(() => {
    if (!isUrl || typeof window === 'undefined') return
    window.location.assign(rawContent)
  }, [isUrl, rawContent])

  if (isLoading) {
    return (
      <LegalPageFrame activeDocumentId={props.documentId}>
        <div className='border-border/70 bg-card flex flex-col gap-4 rounded-2xl border px-6 py-10 shadow-sm sm:px-10'>
          <Skeleton className='h-8 w-[45%]' />
          <Skeleton className='h-4 w-full' />
          <Skeleton className='h-4 w-[90%]' />
          <Skeleton className='h-4 w-[80%]' />
        </div>
      </LegalPageFrame>
    )
  }

  if (!success || !hasContent) {
    return (
      <LegalPageFrame activeDocumentId={props.documentId}>
        <Card className='border-dashed'>
          <CardHeader className='flex flex-row items-center gap-4'>
            <div className='bg-muted rounded-lg p-2'>
              <FileWarning className='text-muted-foreground h-5 w-5' />
            </div>
            <div className='space-y-1'>
              <CardTitle className='text-lg font-semibold'>
                {props.title}
              </CardTitle>
              <p className='text-muted-foreground text-sm'>
                {data?.message || props.emptyMessage}
              </p>
            </div>
          </CardHeader>
        </Card>
      </LegalPageFrame>
    )
  }

  if (isUrl) {
    return (
      <LegalPageFrame activeDocumentId={props.documentId}>
        <Card>
          <CardHeader>
            <CardTitle>{props.title}</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <p className='text-muted-foreground text-sm'>
              {t(
                'The administrator configured an external link for this document.'
              )}
            </p>
            <Button
              render={
                <a href={rawContent} target='_self' rel='noopener noreferrer' />
              }
            >
              {t('View document')}
              <ExternalLink className='size-4' aria-hidden='true' />
            </Button>
          </CardContent>
        </Card>
      </LegalPageFrame>
    )
  }

  return (
    <LegalPageFrame activeDocumentId={props.documentId}>
      <LegalDocumentArticle
        title={props.title}
        content={rawContent}
        contentIsHtml={contentIsHtml}
      />
    </LegalPageFrame>
  )
}

export function LegalDocumentPage(props: { documentId: string }) {
  const { t } = useTranslation()
  const document = LEGAL_DOCUMENTS.find(
    (candidate) => candidate.id === props.documentId
  )

  if (!document) {
    return (
      <PublicLayout>
        <div className='mx-auto max-w-2xl py-12'>
          <Card className='border-dashed'>
            <CardHeader className='flex flex-row items-center gap-4'>
              <div className='bg-muted rounded-lg p-2'>
                <FileWarning className='text-muted-foreground h-5 w-5' />
              </div>
              <div className='space-y-1'>
                <CardTitle className='text-lg font-semibold'>
                  {t('Legal document not found')}
                </CardTitle>
                <p className='text-muted-foreground text-sm'>
                  {t('The requested legal document does not exist.')}
                </p>
              </div>
            </CardHeader>
          </Card>
        </div>
      </PublicLayout>
    )
  }

  return (
    <LegalDocument
      documentId={document.id}
      title={t(document.titleKey)}
      queryKey={`legal-document-${document.id}`}
      fetchDocument={() => getLegalDocument(document.id)}
      emptyMessage={t('This legal document has not been configured yet.')}
    />
  )
}
