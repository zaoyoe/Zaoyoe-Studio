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

import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh.json'

describe('type-led home copy', () => {
  test('keeps the required main-site recharge wording', () => {
    assert.equal(
      en.translation['Recharge on main site'],
      'Recharge on main site'
    )
    assert.equal(zh.translation['Recharge on main site'], '返回主站充值')
  })

  test('keeps the connect-api CTA distinct from Connect', () => {
    assert.equal(en.translation['Connect API'], 'Connect API')
    assert.equal(zh.translation['Connect API'], '接入API')
    assert.equal(zh.translation.Connect, '连接')
  })
})
