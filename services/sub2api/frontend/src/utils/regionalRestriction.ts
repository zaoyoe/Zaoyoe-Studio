import { extractApiErrorCode, extractApiErrorMetadata } from '@/utils/apiError'

export function regionalRestrictionRegistrationPath(): string {
  return '/login?region_blocked=registration'
}

export function isRegionalRestrictionApiError(error: unknown): boolean {
  return extractApiErrorCode(error) === 'REGION_RESTRICTED'
}

export function isRegistrationRegionalRestrictionApiError(error: unknown): boolean {
  if (!isRegionalRestrictionApiError(error)) {
    return false
  }
  const scope = extractApiErrorMetadata(error)?.scope
  return scope === 'registration' || scope === 'oauth_signup'
}

export function isRegistrationRegionalRestrictionFragment(params: URLSearchParams): boolean {
  const error = params.get('error')?.trim() || ''
  const errorMessage = params.get('error_message')?.trim() || ''
  const errorDescription = params.get('error_description')?.trim() || ''
  return (
    error === 'REGION_RESTRICTED' ||
    errorMessage === 'REGION_RESTRICTED' ||
    errorDescription === 'REGION_RESTRICTED'
  )
}
