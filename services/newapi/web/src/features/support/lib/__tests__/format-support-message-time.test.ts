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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  formatSupportConversationTime,
  formatSupportMessageTime,
} from '../format-support-message-time.ts'

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function formatDateTime(value: Date): string {
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(value)
  return `${dateLabel} ${formatTime(value)}`
}

describe('format support message time', () => {
  test('omits the calendar date for later messages on the same local day', () => {
    const morningDate = new Date(2026, 8, 9, 8, 5, 0)
    const afternoonDate = new Date(2026, 8, 9, 18, 41, 0)
    const nextMorningDate = new Date(2026, 8, 10, 9, 2, 0)

    const first = formatSupportMessageTime(morningDate.toISOString())
    const sameDay = formatSupportMessageTime(
      afternoonDate.toISOString(),
      morningDate.toISOString()
    )
    const nextDay = formatSupportMessageTime(
      nextMorningDate.toISOString(),
      afternoonDate.toISOString()
    )

    assert.equal(first, formatDateTime(morningDate))
    assert.equal(sameDay, formatTime(afternoonDate))
    assert.equal(nextDay, formatDateTime(nextMorningDate))
    assert.notEqual(first, sameDay)
  })

  test('keeps the calendar date on conversation list timestamps', () => {
    const afternoonDate = new Date(2026, 8, 9, 18, 41, 0)
    assert.equal(
      formatSupportConversationTime(afternoonDate.toISOString()),
      new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(afternoonDate)
    )
  })

  test('returns null for invalid timestamps', () => {
    assert.equal(formatSupportMessageTime('not-a-date'), null)
    assert.equal(formatSupportConversationTime('not-a-date'), null)
  })
})
