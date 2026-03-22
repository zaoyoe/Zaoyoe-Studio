import { next } from '@vercel/functions';
import {
    getAdminStudioCookieName,
    verifyAdminStudioToken
} from './api/_lib/admin-studio-access.mjs';

function getCookieValue(cookieHeader, cookieName) {
    if (!cookieHeader || !cookieName) return '';

    const segments = String(cookieHeader).split(';');
    for (const segment of segments) {
        const [rawName, ...rawValueParts] = segment.trim().split('=');
        if (rawName === cookieName) {
            return decodeURIComponent(rawValueParts.join('=') || '');
        }
    }
    return '';
}

export default async function middleware(request) {
    const requestUrl = new URL(request.url);
    const redirectUrl = new URL('/admin-entry', request.url);
    redirectUrl.searchParams.set('next', `${requestUrl.pathname}${requestUrl.search}`);

    try {
        const cookieValue = getCookieValue(
            request.headers.get('cookie') || '',
            getAdminStudioCookieName()
        );

        const payload = await verifyAdminStudioToken(cookieValue);
        if (payload?.sub) {
            return next();
        }
    } catch (_) {
        // Fail closed into the admin-entry trampoline instead of surfacing
        // a middleware invocation error to the browser.
    }

    return Response.redirect(redirectUrl, 307);
}

export const config = {
    matcher: ['/admin-studio', '/admin-studio.html'],
    runtime: 'nodejs'
};
