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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getSuccessRateDotClass } from '@/features/performance-metrics/lib/format'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import type { ChannelStatusPoint, ChannelStatusWindow } from '../types'

type StatusBarsProps = {
  series: ChannelStatusPoint[]
  window: ChannelStatusWindow
}

export function StatusBars(props: StatusBarsProps) {
  const { t } = useTranslation()
  const timeFormat = props.window === '24h' ? 'MM-DD HH:mm' : 'YYYY-MM-DD HH:mm'

  if (props.window === 'recent') {
    const seen = new Map<string, number>()
    return (
      <div
        className='flex h-7 min-w-[220px] items-stretch gap-1'
        role='img'
        aria-label={t('Recent status')}
      >
        {props.series.map((point) => {
          const key = String(point.success_rate)
          const count = (seen.get(key) ?? 0) + 1
          seen.set(key, count)
          const empty = point.success_rate == null
          return (
            <Tooltip key={`${key}-${count}`}>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      'w-5 flex-none rounded-[2px] transition-opacity hover:opacity-75',
                      empty
                        ? 'bg-muted-foreground/20'
                        : getSuccessRateDotClass(
                            point.success_rate ?? Number.NaN
                          )
                    )}
                    aria-label={
                      empty
                        ? t('No data')
                        : `${(point.success_rate ?? 0).toFixed(2)}%`
                    }
                  />
                }
              />
              <TooltipContent side='top' className='text-xs'>
                <div className='font-medium'>{t('5 valid requests')}</div>
                <div className='text-muted-foreground mt-0.5'>
                  {empty
                    ? t('No data')
                    : t('Success rate: {{rate}}', {
                        rate: `${(point.success_rate ?? 0).toFixed(2)}%`,
                      })}
                </div>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className='flex h-7 min-w-[220px] items-stretch gap-1'
      role='img'
      aria-label={t('Recent status')}
    >
      {props.series.map((point) => {
        const ts = point.ts ?? 0
        const label = dayjs(ts * 1000).format(timeFormat)
        const empty = point.success_rate == null
        return (
          <Tooltip key={ts}>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    'min-w-1 flex-1 rounded-[2px] transition-opacity hover:opacity-75',
                    empty
                      ? 'bg-muted-foreground/20'
                      : getSuccessRateDotClass(point.success_rate ?? Number.NaN)
                  )}
                  aria-label={
                    empty
                      ? `${label}: ${t('No data')}`
                      : `${label}: ${(point.success_rate ?? 0).toFixed(2)}%`
                  }
                />
              }
            />
            <TooltipContent side='top' className='text-xs'>
              <div className='font-mono font-medium'>{label}</div>
              <div className='text-muted-foreground mt-0.5'>
                {empty
                  ? t('No data')
                  : t('Success rate: {{rate}}', {
                      rate: `${(point.success_rate ?? 0).toFixed(2)}%`,
                    })}
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
