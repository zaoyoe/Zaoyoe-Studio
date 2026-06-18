import { describe, expect, it } from 'vitest'

import {
  isRegistrationRegionalRestrictionApiError,
  isRegistrationRegionalRestrictionFragment,
  regionalRestrictionRegistrationPath
} from '@/utils/regionalRestriction'

describe('regional restriction helpers', () => {
  it('routes registration restrictions back to the login registration dialog', () => {
    expect(regionalRestrictionRegistrationPath()).toBe('/login?region_blocked=registration')
  })

  it('matches only registration and OAuth signup API restriction scopes', () => {
    expect(
      isRegistrationRegionalRestrictionApiError({
        reason: 'REGION_RESTRICTED',
        metadata: { scope: 'registration' }
      })
    ).toBe(true)
    expect(
      isRegistrationRegionalRestrictionApiError({
        reason: 'REGION_RESTRICTED',
        metadata: { scope: 'oauth_signup' }
      })
    ).toBe(true)
    expect(
      isRegistrationRegionalRestrictionApiError({
        reason: 'REGION_RESTRICTED',
        metadata: { scope: 'api_key_create' }
      })
    ).toBe(false)
  })

  it('recognizes regional restriction fragments from OAuth providers', () => {
    expect(
      isRegistrationRegionalRestrictionFragment(
        new URLSearchParams('error=REGION_RESTRICTED')
      )
    ).toBe(true)
    expect(
      isRegistrationRegionalRestrictionFragment(
        new URLSearchParams('error_description=REGION_RESTRICTED')
      )
    ).toBe(true)
    expect(isRegistrationRegionalRestrictionFragment(new URLSearchParams('error=access_denied'))).toBe(false)
  })
})
