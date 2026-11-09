# 管理后台 Cloudflare Access 外层校验

主站、TG 和 KC 的后台各有两层保护：Cloudflare Access 负责进入后台前的
外层身份验证，应用自己的登录/会话/二次校验负责业务授权。仓库代码只能维护
第二层；Cloudflare Access 应用、策略和 DNS 代理属于账户外部配置，不能随
Vercel 部署复制。

## 受保护入口

| 系统 | 入口 | 未登录的预期响应 |
| --- | --- | --- |
| 主站 | `https://www.fatherkey.com/admin-studio.html`、`/admin.html` | `302` 到 Cloudflare Access 登录，并带 `www-authenticate: Cloudflare-Access` |
| KC | `https://adm.fatherkey.com/`、`/admin-login` | `302` 到 Cloudflare Access 登录，并带 `www-authenticate: Cloudflare-Access` |
| TG | `https://tg.adm.fatherkey.com/`、`/tg-admin` | `302` 到 Cloudflare Access 登录，并带 `www-authenticate: Cloudflare-Access` |

只返回 HTTP 200、Vercel `server` 标识或静态登录页不算通过。应用自己的登录
页能正常显示，也不能替代这条外层证据。

## 发布后检查

只读检查，不要跟随重定向，也不要把响应中的 cookie、URL 参数或令牌写入日志：

```bash
for url in \
  https://www.fatherkey.com/admin-studio.html \
  https://www.fatherkey.com/admin.html \
  https://adm.fatherkey.com/ \
  https://adm.fatherkey.com/admin-login \
  https://tg.adm.fatherkey.com/ \
  https://tg.adm.fatherkey.com/tg-admin; do
  curl --silent --show-error --head --max-redirs 0 "$url" \
    | grep -Eiq '^(HTTP/|location:|www-authenticate:|server:)' \
    || exit 1
done
```

逐个入口记录状态码、`location` 的主机名和是否存在
`www-authenticate: Cloudflare-Access`；不要记录完整的 `location`，因为其中
可能含有一次性登录参数。

## 当前核查（2026-11-09）

- 主站两个入口：**PASS**，均由 Cloudflare Access 返回 302。
- KC 两个入口：**PASS**，均由 Cloudflare Access 返回 302。
- TG `/tg-admin.html` 会 308 到 `/tg-admin`，随后直接返回 Vercel 200，**FAIL**；
  未观察到 Cloudflare Access 外层响应。当前 TG 管理页面仍有应用自己的登录
  面板，这不能证明 CF 校验存在。

TG 的 DNS 当前直接指向 Vercel DNS，说明这不是本次静态文件部署丢失的代码，
而是 Cloudflare 账户中的 Access 应用/策略或 DNS 代理配置缺失。恢复步骤：

1. 在 Cloudflare Zero Trust 中恢复 `tg.adm.fatherkey.com/*` 的 Self-hosted
   Access application。
2. 复用主站/KC 后台相同的管理员身份策略和会话时长，确认没有宽泛的 Allow
   或 Bypass 规则。
3. 确认 `tg.adm.fatherkey.com` 经过 Cloudflare 代理后再指向 Vercel；不要
   改动 Vercel 的 `/tg-admin` 页面或应用会话代码来冒充外层保护。
4. 清理旧浏览器会话后，重新执行本页六个入口的无重定向检查，再用受保护的
   浏览器会话确认 TG 应用登录和 API 操作仍能完成。

如果没有 Cloudflare 账户/API 权限，发布记录必须写成 `PENDING 外部配置`，
不能报告三个后台都已通过。
