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
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { isExternalUrl } from '@/lib/main-site'
import { cn } from '@/lib/utils'

type BrandHomeLinkProps = {
  homeUrl: string
  className?: string
  children: ReactNode
  onClick?: () => void
}

interface HeaderLogoProps {
  src: string
  alt?: string
  loading: boolean
  logoLoaded: boolean
  className?: string
}

/**
 * Public/sidebar brand link that can point at an internal route or the main site.
 */
export function BrandHomeLink({
  homeUrl,
  className,
  children,
  onClick,
}: BrandHomeLinkProps) {
  if (isExternalUrl(homeUrl)) {
    return (
      <a
        href={homeUrl}
        target='_blank'
        rel='noopener noreferrer'
        className={className}
        onClick={onClick}
      >
        {children}
      </a>
    )
  }

  return (
    <Link to={homeUrl} className={className} onClick={onClick}>
      {children}
    </Link>
  )
}

/**
 * Logo component for header with loading state
 * Shows image only when fully loaded for smooth UX
 */
export function HeaderLogo({
  src,
  alt = 'logo',
  loading,
  logoLoaded,
  className,
}: HeaderLogoProps) {
  return (
    <img
      src={src}
      alt={alt}
      className={cn(
        'h-6 w-6 rounded-full transition-opacity duration-200',
        !loading && logoLoaded ? 'opacity-100' : 'opacity-0',
        className
      )}
    />
  )
}
