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
  DOMESTIC_MAIN_SITE_URL,
  INTERNATIONAL_MAIN_SITE_URL,
  getMainSiteUrl,
  isExternalUrl,
  isInternationalHost,
} from './main-site'

describe('main site branding urls', () => {
  test('treats zaoyoe.xyz hosts as the international site', () => {
    assert.equal(isInternationalHost('zaoyoe.xyz'), true)
    assert.equal(isInternationalHost('www.zaoyoe.xyz'), true)
    assert.equal(isInternationalHost('new.zaoyoe.xyz'), true)
    assert.equal(isInternationalHost('new.fatherkey.com'), false)
    assert.equal(isInternationalHost('localhost'), false)
  })

  test('points China and international brands at the matching main site', () => {
    assert.equal(getMainSiteUrl('new.fatherkey.com'), DOMESTIC_MAIN_SITE_URL)
    assert.equal(getMainSiteUrl('www.fatherkey.com'), DOMESTIC_MAIN_SITE_URL)
    assert.equal(getMainSiteUrl('new.zaoyoe.xyz'), INTERNATIONAL_MAIN_SITE_URL)
    assert.equal(getMainSiteUrl('zaoyoe.xyz'), INTERNATIONAL_MAIN_SITE_URL)
  })

  test('detects external brand urls', () => {
    assert.equal(isExternalUrl(DOMESTIC_MAIN_SITE_URL), true)
    assert.equal(isExternalUrl('/'), false)
    assert.equal(isExternalUrl('/dashboard'), false)
  })
})
