# Zaoyoe Supabase Auth Email Templates

Copy the `.html.tpl` files into Supabase Dashboard > Authentication > Email Templates.

Recommended subjects:

- Confirm signup: `确认你的 Zaoyoe 账号`
- Magic link: `登录 Zaoyoe`
- Reset password: `重置你的 Zaoyoe 密码`
- Change email: `确认你的 Zaoyoe 新邮箱`

The templates intentionally use Supabase template variables such as `{{ .ConfirmationURL }}` instead of hard-coded Supabase project URLs. This keeps Custom SMTP and Supabase Custom Domain optional: if they are not configured, Supabase default delivery still works.
