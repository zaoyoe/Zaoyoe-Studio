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

import { GroupBadge } from '@/components/group-badge'
import {
  formatLatency,
  formatThroughput,
  getSuccessRateTextClass,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import type {
  ChannelStatusDisplay,
  ChannelStatusGroup,
  ChannelStatusWindow,
} from '../types'
import { StatusBars } from './status-bars'

type StatusTableProps = {
  groups: ChannelStatusGroup[]
  display: ChannelStatusDisplay
  window: ChannelStatusWindow
}

function SuccessRateValue(props: { value?: number | null }) {
  const { t } = useTranslation()
  if (props.value == null) {
    return <span className='text-muted-foreground'>{t('No data')}</span>
  }
  return (
    <span
      className={cn(
        'font-mono font-semibold tabular-nums',
        getSuccessRateTextClass(props.value)
      )}
    >
      {props.value.toFixed(2)}%
    </span>
  )
}

function ExtraMetrics(props: {
  group: ChannelStatusGroup
  display: ChannelStatusDisplay
}) {
  const { t } = useTranslation()
  const items: Array<{ label: string; value: string }> = []
  if (props.display.show_tps) {
    items.push({
      label: 'TPS',
      value:
        props.group.avg_tps == null
          ? t('No data')
          : formatThroughput(props.group.avg_tps),
    })
  }
  if (props.display.show_ttft) {
    items.push({
      label: t('Average TTFT'),
      value:
        props.group.avg_ttft_ms == null
          ? t('No data')
          : formatLatency(props.group.avg_ttft_ms),
    })
  }
  if (props.display.show_latency) {
    items.push({
      label: t('Average latency'),
      value:
        props.group.avg_latency_ms == null
          ? t('No data')
          : formatLatency(props.group.avg_latency_ms),
    })
  }
  if (items.length === 0) return null
  return (
    <dl className='grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3'>
      {items.map((item) => (
        <div key={item.label} className='min-w-0'>
          <dt className='text-muted-foreground text-xs'>{item.label}</dt>
          <dd className='mt-0.5 truncate font-mono text-sm tabular-nums'>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function StatusTable(props: StatusTableProps) {
  const { t } = useTranslation()
  return (
    <>
      <div className='border-border hidden overflow-x-auto rounded-lg border md:block'>
        <table className='w-full min-w-[760px] border-collapse text-sm'>
          <thead className='bg-muted/40 text-muted-foreground'>
            <tr className='border-b'>
              <th className='h-10 px-4 text-left font-medium'>{t('Group')}</th>
              <th className='h-10 px-4 text-right font-medium'>
                {t('Success rate')}
              </th>
              <th className='h-10 min-w-[280px] px-4 text-left font-medium'>
                {t('Recent status')}
              </th>
              {props.display.show_tps ? (
                <th className='h-10 px-4 text-right font-medium'>TPS</th>
              ) : null}
              {props.display.show_ttft ? (
                <th className='h-10 px-4 text-right font-medium'>
                  {t('Average TTFT')}
                </th>
              ) : null}
              {props.display.show_latency ? (
                <th className='h-10 px-4 text-right font-medium'>
                  {t('Average latency')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className='divide-y'>
            {props.groups.map((group) => (
              <tr key={group.group} className='hover:bg-muted/20'>
                <td className='h-16 px-4'>
                  <GroupBadge group={group.group} size='sm' />
                </td>
                <td className='h-16 px-4 text-right'>
                  <SuccessRateValue value={group.success_rate} />
                </td>
                <td className='h-16 px-4'>
                  <StatusBars series={group.series} window={props.window} />
                </td>
                {props.display.show_tps ? (
                  <td className='h-16 px-4 text-right font-mono tabular-nums'>
                    {group.avg_tps == null
                      ? t('No data')
                      : formatThroughput(group.avg_tps)}
                  </td>
                ) : null}
                {props.display.show_ttft ? (
                  <td className='h-16 px-4 text-right font-mono tabular-nums'>
                    {group.avg_ttft_ms == null
                      ? t('No data')
                      : formatLatency(group.avg_ttft_ms)}
                  </td>
                ) : null}
                {props.display.show_latency ? (
                  <td className='h-16 px-4 text-right font-mono tabular-nums'>
                    {group.avg_latency_ms == null
                      ? t('No data')
                      : formatLatency(group.avg_latency_ms)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className='border-border divide-y rounded-lg border md:hidden'>
        {props.groups.map((group) => (
          <section key={group.group} className='space-y-3 px-3 py-4'>
            <div className='flex items-center justify-between gap-3'>
              <GroupBadge group={group.group} size='sm' />
              <SuccessRateValue value={group.success_rate} />
            </div>
            <StatusBars series={group.series} window={props.window} />
            <ExtraMetrics group={group} display={props.display} />
          </section>
        ))}
      </div>
    </>
  )
}
