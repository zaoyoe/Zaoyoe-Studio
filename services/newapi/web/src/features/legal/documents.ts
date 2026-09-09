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

For commercial licensing, please contact support@quantumnous.com
*/
import type { SystemStatus } from '@/features/auth/types'

import type { LegalDocumentId } from './types'

export type LegalVisibilityKey =
  | 'api_key_terms_enabled'
  | 'api_key_privacy_enabled'
  | 'api_key_acceptable_use_enabled'
  | 'api_key_refund_enabled'
  | 'api_key_restricted_regions_enabled'

export const LEGAL_DOCUMENTS = [
  {
    id: 'terms',
    titleKey: 'Terms of Service',
    visibilityKey: 'api_key_terms_enabled',
  },
  {
    id: 'privacy',
    titleKey: 'Privacy Policy',
    visibilityKey: 'api_key_privacy_enabled',
  },
  {
    id: 'acceptable-use',
    titleKey: 'Acceptable Use Policy',
    visibilityKey: 'api_key_acceptable_use_enabled',
  },
  {
    id: 'refund',
    titleKey: 'Refund Policy',
    visibilityKey: 'api_key_refund_enabled',
  },
  {
    id: 'restricted-regions',
    titleKey: 'Restricted Regions',
    visibilityKey: 'api_key_restricted_regions_enabled',
  },
] as const satisfies ReadonlyArray<{
  id: LegalDocumentId
  titleKey: string
  visibilityKey: LegalVisibilityKey
}>

export function getVisibleLegalDocuments(
  status: Pick<SystemStatus, LegalVisibilityKey> | null | undefined
) {
  return LEGAL_DOCUMENTS.filter(
    ({ visibilityKey }) => status?.[visibilityKey] !== false
  )
}
