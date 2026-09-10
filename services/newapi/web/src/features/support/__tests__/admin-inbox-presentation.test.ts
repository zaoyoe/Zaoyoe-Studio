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
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const inboxSource = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'admin-inbox.tsx'
  ),
  'utf8'
)

describe('admin inbox presentation', () => {
  test('incoming customer bubbles omit the customer label and use a stronger gray', () => {
    assert.match(
      inboxSource,
      /\{isAgent \? <span>\{t\('You'\)\}<\/span> : null\}/
    )
    assert.doesNotMatch(inboxSource, /isAgent \? t\('You'\) : t\('Customer'\)/)
    assert.match(
      inboxSource,
      /bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100 rounded-bl-sm/
    )
  })
})
