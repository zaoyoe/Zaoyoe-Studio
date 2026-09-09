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

import { getSupportApiError, SupportApiError } from './api'

describe('support API errors', () => {
  test('keeps the support code without exposing an Axios response message', () => {
    const error = getSupportApiError(
      {
        isAxiosError: true,
        response: {
          data: {
            code: 'SUPPORT_GATEWAY_UNAVAILABLE',
            message: 'gateway timeout details must not reach the UI',
          },
        },
      },
      'Unable to load support'
    )

    assert.ok(error instanceof SupportApiError)
    assert.equal(error.code, 'SUPPORT_GATEWAY_UNAVAILABLE')
    assert.equal(error.fallbackKey, 'Unable to load support')
    assert.equal(error.message, 'Unable to load support')
  })

  test('uses a translated fallback key for unexpected failures', () => {
    const error = getSupportApiError(
      new Error('Network Error'),
      'Unable to send support message'
    )

    assert.equal(error.code, undefined)
    assert.equal(error.fallbackKey, 'Unable to send support message')
    assert.equal(error.message, 'Unable to send support message')
  })
})
