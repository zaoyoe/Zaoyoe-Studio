# Supabase Auth Branding Checklist

This step improves trust and brand feel for login and account recovery. It must stay optional: if Custom SMTP or Supabase Custom Domain is not configured, the site should keep using the current Supabase auth flow.

## Dashboard Setup

Use `supabase/auth-email-templates/dashboard-config.json` as the source of truth for the values below.

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
   - Use these subjects:
     - Confirm signup: `确认你的 Zaoyoe 账号`
     - Magic Link: `登录 Zaoyoe`
     - Reset Password: `重置你的 Zaoyoe 密码`
     - Change Email Address: `确认你的 Zaoyoe 新邮箱`
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
5. Confirm Supabase Dashboard still lists all four Additional Redirect URLs after saving.
6. If Custom SMTP is enabled, send one reset email and check that the visible sender is `Zaoyoe`.

## Fallback Rule

Do not hard-code the Supabase project auth domain in frontend redirects. Frontend auth redirects should use the current site origin so `www.zaoyoe.com` and `zaoyoe.xyz` keep working whether or not the Supabase Custom Domain add-on is active.

Custom SMTP and Supabase Custom Domain are optional. Missing SMTP should only affect sender branding, not password reset or Google login availability.
