# Supabase Auth Branding Checklist

This step improves trust and brand feel for login and account recovery. It must stay optional: if Custom SMTP or Supabase Custom Domain is not configured, the site should keep using the current Supabase auth flow.

## Dashboard Setup

1. Supabase Dashboard > Authentication > URL Configuration
   - Site URL: `https://www.zaoyoe.com`
   - Additional Redirect URLs:
     - `https://www.zaoyoe.com/auth-callback.html`
     - `https://www.zaoyoe.com/reset-password.html`
     - `https://zaoyoe.xyz/auth-callback.html`
     - `https://zaoyoe.xyz/reset-password.html`
2. Supabase Dashboard > Authentication > SMTP Settings
   - Enable Custom SMTP when the sending domain is ready.
   - Use a branded sender such as `Zaoyoe <no-reply@zaoyoe.com>`.
   - If SMTP is not ready, leave it disabled; Supabase default delivery remains the fallback.
3. Supabase Dashboard > Authentication > Email Templates
   - Copy templates from `supabase/auth-email-templates/`.
   - Keep `{{ .ConfirmationURL }}` unchanged.
4. Optional add-on: Supabase Custom Domain
   - Configure only after DNS and SSL are ready.
   - This is a brand/trust upgrade, not a frontend runtime dependency.

## Verification

Run:

```bash
npm run readiness:auth-branding
```

Manual smoke:

1. Request password reset from `https://www.zaoyoe.com`.
2. Request password reset from `https://zaoyoe.xyz`.
3. Confirm each email opens the matching site's `/reset-password.html`.
4. Test Google login on both sites and confirm it returns through `/auth-callback.html`.

## Fallback Rule

Do not hard-code the Supabase project auth domain in frontend redirects. Frontend auth redirects should use the current site origin so `www.zaoyoe.com` and `zaoyoe.xyz` keep working whether or not the Supabase Custom Domain add-on is active.
