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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import en from '../i18n/locales/en.json' with { type: 'json' }
import zh from '../i18n/locales/zh.json' with { type: 'json' }
import zhTW from '../i18n/locales/zh-TW.json' with { type: 'json' }

import {
  DOMESTIC_MAIN_SITE_URL,
  INTERNATIONAL_MAIN_SITE_URL,
  getMainSitePath,
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
    assert.equal(isExternalUrl(undefined), false)
    assert.equal(isExternalUrl(''), false)
  })

  test('joins main-site paths without duplicating slashes', () => {
    assert.equal(
      getMainSitePath('/prompts', 'new.fatherkey.com'),
      'https://www.fatherkey.com/prompts'
    )
    assert.equal(
      getMainSitePath('prompts', 'www.fatherkey.com'),
      'https://www.fatherkey.com/prompts'
    )
    assert.equal(
      getMainSitePath('/prompts', 'new.zaoyoe.xyz'),
      'https://www.zaoyoe.xyz/prompts'
    )
  })
})

describe('visual generation sidebar entry', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const sidebar = readFileSync(join(here, '../hooks/use-sidebar-data.ts'), 'utf8')
  const navGroup = readFileSync(
    join(here, '../components/layout/components/nav-group.tsx'),
    'utf8'
  )
  const commandMenu = readFileSync(
    join(here, '../components/command-menu.tsx'),
    'utf8'
  )

  test('puts visual generation under general and points at main-site prompts', () => {
    assert.match(sidebar, /id: 'general'/)
    assert.match(sidebar, /title: t\('Visual generation'\)/)
    assert.match(sidebar, /url: getMainSitePath\('\/prompts'\)/)
  })

  test('keeps chinese and english labels for visual generation', () => {
    assert.equal(en.translation['Visual generation'], 'Visual generation')
    assert.equal(zh.translation['Visual generation'], '视觉生成')
    assert.equal(zhTW.translation['Visual generation'], '視覺生成')
  })

  test('opens external sidebar destinations instead of in-app routes', () => {
    assert.match(navGroup, /function NavDestination/)
    assert.match(navGroup, /isExternalUrl\(url\)/)
    assert.match(commandMenu, /isExternalUrl\(url\)/)
    assert.match(commandMenu, /globalThis\.location\.assign\(url\)/)
  })

  test('forwards render-slot props so sidebar labels keep theme color', () => {
    assert.match(navGroup, /\{\.\.\.props\} href=\{url\}/)
    assert.match(navGroup, /<Link \{\.\.\.props\} to=\{url\} \/>/)
  })
})

