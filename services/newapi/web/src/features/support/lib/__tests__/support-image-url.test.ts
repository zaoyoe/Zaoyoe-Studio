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

import { getSupportImageUrl } from '../support-image-url'

describe('support image URL allowlist', () => {
  test('accepts first-party https, blob, and image data URLs', () => {
    assert.equal(
      getSupportImageUrl('https://cdn.fatherkey.com/chat/session/pixel.webp'),
      'https://cdn.fatherkey.com/chat/session/pixel.webp'
    )
    assert.equal(
      getSupportImageUrl(
        'blob:https://new.fatherkey.com/11111111-2222-3333-4444-555555555555'
      ),
      'blob:https://new.fatherkey.com/11111111-2222-3333-4444-555555555555'
    )
    assert.equal(
      getSupportImageUrl(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
      ),
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    )
  })

  test('rejects r2.dev, credentials, and non-https URLs', () => {
    assert.equal(
      getSupportImageUrl('https://pub-123.r2.dev/chat/session/pixel.png'),
      null
    )
    assert.equal(
      getSupportImageUrl(
        'https://user:pass@cdn.fatherkey.com/chat/session/pixel.png'
      ),
      null
    )
    assert.equal(
      getSupportImageUrl('http://cdn.fatherkey.com/chat/session/pixel.png'),
      null
    )
    assert.equal(getSupportImageUrl('/chat/session/pixel.png'), null)
    assert.equal(getSupportImageUrl('javascript:alert(1)'), null)
  })
})
