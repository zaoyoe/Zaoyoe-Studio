/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { api } from '@/lib/api'

import { getChannels } from '../api'

const originalGet = api.get

afterEach(() => {
  api.get = originalGet
})

describe('channel API contract', () => {
  test('requests the channel collection at the registered trailing-slash route', async () => {
    let request: { url: string; config?: unknown } | undefined
    api.get = (async (url: string, config?: unknown) => {
      request = { url, config }
      return { data: { success: true, data: [] } }
    }) as typeof api.get

    await getChannels({ p: 1, page_size: 20 })

    assert.equal(request?.url, '/api/channel/')
    assert.deepEqual(request?.config, { params: { p: 1, page_size: 20 } })
  })
})
