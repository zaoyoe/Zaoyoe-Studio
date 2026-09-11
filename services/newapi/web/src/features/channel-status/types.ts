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
export type ChannelStatusWindow = 'recent' | '24h' | '7d' | '15d' | '30d'

export type ChannelStatusPoint = {
  ts?: number | null
  success_rate?: number | null
}

export type ChannelStatusGroup = {
  group: string
  success_rate?: number | null
  series: ChannelStatusPoint[]
  avg_tps?: number | null
  avg_ttft_ms?: number | null
  avg_latency_ms?: number | null
}

export type ChannelStatusDisplay = {
  show_tps: boolean
  show_ttft: boolean
  show_latency: boolean
}

export type ChannelStatusSnapshot = {
  window: ChannelStatusWindow
  available_windows: ChannelStatusWindow[]
  updated_at: number
  display: ChannelStatusDisplay
  groups: ChannelStatusGroup[]
}

export const CHANNEL_STATUS_WINDOWS: Array<{
  value: ChannelStatusWindow
  label: string
}> = [
  { value: 'recent', label: 'Recent' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '15d', label: '15D' },
  { value: '30d', label: '30D' },
]
