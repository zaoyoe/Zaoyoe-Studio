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
export const DOMESTIC_MAIN_SITE_URL = 'https://www.fatherkey.com/'
export const INTERNATIONAL_MAIN_SITE_URL = 'https://www.zaoyoe.xyz/'

export function isInternationalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return host === 'zaoyoe.xyz' || host.endsWith('.zaoyoe.xyz')
}

export function isExternalUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

export function getMainSiteUrl(
  hostname = globalThis.location?.hostname ?? ''
): string {
  return isInternationalHost(hostname)
    ? INTERNATIONAL_MAIN_SITE_URL
    : DOMESTIC_MAIN_SITE_URL
}

export function getMainSitePath(
  path: string,
  hostname = globalThis.location?.hostname ?? ''
): string {
  const base = getMainSiteUrl(hostname).replace(/\/+$/, '')
  const normalized = path.trim()
  if (!normalized || normalized === '/') {
    return `${base}/`
  }
  const suffix = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `${base}${suffix}`
}
