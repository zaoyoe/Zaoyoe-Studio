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

  test('strips sentence punctuation from 01-05 headings', () => {
    assert.equal(en.translation['Same account.'], 'Same account')
    assert.equal(zh.translation['Same account.'], '同一个账户')
    assert.equal(en.translation['Start where you are.'], 'Start where you are')
    assert.equal(zh.translation['Start where you are.'], '按你的方式开始')
    assert.equal(en.translation['Familiar routes.'], 'Familiar routes')
    assert.equal(zh.translation['Familiar routes.'], '熟悉的接口')
    assert.equal(en.translation['One ledger.'], 'One ledger')
    assert.equal(zh.translation['One ledger.'], '同一套账本')
    assert.equal(
      en.translation['Top up on the main site.'],
      'Top up on the main site'
    )
    assert.equal(zh.translation['Top up on the main site.'], '额度在主站充值')
    assert.equal(en.translation['Keep the ledger clear.'], 'Keep the ledger clear')
    assert.equal(zh.translation['Keep the ledger clear.'], '账本始终清晰')
    assert.equal(
      en.translation['One key. Three protocols.'],
      'One key Three protocols'
    )
    assert.equal(zh.translation['One key. Three protocols.'], '一把密钥 三条协议')
    assert.equal(
      en.translation['Start with the actual task.'],
      'Start with the actual task'
    )
    assert.equal(
      zh.translation['Start with the actual task.'],
      '从真正要做的事开始'
    )
  })
})
