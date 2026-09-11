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
import { useNavigate, useSearch } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { PageTransition } from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import dayjs from '@/lib/dayjs'

import { getChannelStatus } from './api'
import { StatusTable } from './components/status-table'
import { CHANNEL_STATUS_WINDOWS, type ChannelStatusWindow } from './types'

const VALID_WINDOWS = CHANNEL_STATUS_WINDOWS.map((item) => item.value)

export function ChannelStatusPage() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/channel-status/' })
  const navigate = useNavigate()
  const windowValue: ChannelStatusWindow = VALID_WINDOWS.includes(
    search.window as ChannelStatusWindow
  )
    ? (search.window as ChannelStatusWindow)
    : 'recent'

  const query = useQuery({
    queryKey: ['channel-status', windowValue],
    queryFn: () => getChannelStatus(windowValue),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const snapshot = query.data?.data
  const availableWindows = snapshot?.available_windows ?? VALID_WINDOWS

  let body: ReactNode
  if (query.isLoading) {
    body = (
      <div className='space-y-2' aria-label={t('Loading channel status')}>
        <Skeleton className='h-10 w-full rounded-lg' />
        <Skeleton className='h-16 w-full rounded-lg' />
        <Skeleton className='h-16 w-full rounded-lg' />
        <Skeleton className='h-16 w-full rounded-lg' />
      </div>
    )
  } else if (query.isError || !snapshot) {
    body = (
      <div className='border-border rounded-lg border border-dashed px-4 py-12 text-center'>
        <p className='text-muted-foreground text-sm'>
          {t('Unable to load channel status')}
        </p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='mt-4'
          onClick={() => {
            void query.refetch()
          }}
        >
          <RefreshCw data-icon='inline-start' />
          {t('Retry')}
        </Button>
      </div>
    )
  } else if (snapshot.groups.length === 0) {
    body = (
      <div className='border-border text-muted-foreground rounded-lg border border-dashed px-4 py-12 text-center text-sm'>
        {t('No channel groups are available')}
      </div>
    )
  } else {
    body = (
      <StatusTable
        groups={snapshot.groups}
        display={snapshot.display}
        window={snapshot.window}
      />
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <PageTransition className='mx-auto w-full max-w-[1180px] px-3 pt-24 pb-12 sm:px-6 lg:px-8'>
        <header className='mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <h1 className='text-foreground text-2xl font-semibold sm:text-3xl'>
              {t('Channel status')}
            </h1>
            {snapshot ? (
              <p className='text-muted-foreground mt-1 text-xs'>
                {t('Updated {{time}}', {
                  time: dayjs(snapshot.updated_at * 1000).format(
                    'YYYY-MM-DD HH:mm:ss'
                  ),
                })}
              </p>
            ) : null}
          </div>
          <ToggleGroup
            value={[snapshot?.window ?? windowValue]}
            onValueChange={(value) => {
              const next = value.find((item) => item !== windowValue) as
                | ChannelStatusWindow
                | undefined
              if (!next || next === windowValue) return
              void navigate({
                to: '/channel-status',
                search: { window: next },
              })
            }}
            variant='outline'
            size='sm'
            spacing={0}
            multiple={false}
            aria-label={t('Time range')}
          >
            {CHANNEL_STATUS_WINDOWS.filter((item) =>
              availableWindows.includes(item.value)
            ).map((item) => (
              <ToggleGroupItem key={item.value} value={item.value}>
                {item.value === 'recent' ? t(item.label) : item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </header>
        {body}
      </PageTransition>
    </PublicLayout>
  )
}
