# KVM4 游客购买「即时发货」部署与审计规范 v2

> **用途**：把已合并进 `main` 的游客购买代码，在 KVM4 Verify Server 上接到低延迟履约路径
> （支付 webhook / 状态轮询触发即时 kick + host 上每 10 秒的 systemd timer 兜底）。
>
> **本文不做**：不启用游客商品或 SKU、不执行 SQL、不打印任何密钥值、不从功能分支部署。
>
> **冲突时以下列为准**：`AGENTS.md`、`docs/kvm4-verify-server-deploy.md`、
> `docs/guest-shop-payment-fulfillment-runbook.md`、`docs/guest-purchase-task-2.0.md`。
>
> 本文替代 `kvm4-deployment-guide.md`、`DEPLOYMENT_STEPS.md` 里的旧步骤；
> `DEPLOYMENT_IMMEDIATE_FULFILLMENT.md` 等 6 份草稿已归档到
> `docs/archive/2026-09-instant-fulfillment-drafts/`（目录 README 标注了其中禁止执行的命令）。
> 旧文档中的 `systemctl restart zaoyoe-verify-server`、`pm2 restart all`、
> `cat /opt/zaoyoe-verify-server/.env`、`kill -9 $(lsof -ti:3001)` 都是错误做法。

---

## 0. 生产状态快照（2026-09-17 复核）

| 链路 | 状态 | 证据 |
|---|---|---|
| `main` | `aef4c0cc101cf30f412bb45dd67ce99d5b8bc7b4` | PR #648 已合并（2026-09-17 07:14 UTC） |
| Vercel production | ● Ready | `dpl_3RqUQVKiAXqm6AMmmLR8G972Z4Gu`，别名含 `www.fatherkey.com`，构建于 15:36 CST（合并之后） |
| Deploy KVM4 Verify Server | success | run `35193525564` @ `aef4c0cc1` |
| Deploy KVM4 Sub2API | success | run `35193525577` @ `aef4c0cc1` |
| Security Tests | success | run `35193525527` @ `aef4c0cc1` |
| verify 健康 | 200 | `https://verify-api.fatherkey.com/healthz`，`uptime_seconds` 与 07:15 UTC 部署时间吻合 |
| NewAPI 健康 | 200 | `https://new.fatherkey.com/health` |
| KVM4 `.current-release` | 待 SSH 复核 | 本机 SSH 在握手阶段被远端关闭（见 §6 最后一条） |
| 容器内 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED` | 待确认 | 只能在容器内确认，见 §4 审计脚本 |
| `zaoyoe-guest-shop-worker.timer` | 待确认 | 见 §4 审计脚本 |

**结论**：即时 kick 的代码（`api/public.js`、`api/shop/guest/status.js`、两个 webhook 路由、
前端智能轮询）已经随 `aef4c0cc1` 上线。真正决定「能不能 1-3 秒发货」的只剩两件运维事项：

1. verify 容器内 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=true`（另两个条件由 compose 固定）；
2. host 上每 10 秒的兜底 timer 已安装并启动。

---

## 1. 延迟模型：1-3 秒从哪里来

| 触发点 | 路径 | 典型延迟 |
|---|---|---|
| 支付平台 webhook | `POST /api/shop/guest/webhooks/{zpay,nowpayments}` → `kick(orderId)` → `processOrderById()` | 1-3 秒 |
| 买家页面状态轮询 | `GET /api/shop/guest/status` 发现 `payment_status=confirmed` → `kick(orderId)` | 1-3 秒（受轮询间隔影响） |
| 兜底 timer（持久化） | host `zaoyoe-guest-shop-worker.timer` 每 10 秒 → `POST 127.0.0.1:3001/api/shop/guest/worker` | ≤ 10 秒 + 处理时间 |

kick 只在长驻进程里生效。`server/guest-shop-worker.js` 的
`isGuestShopImmediateFulfillmentEnabled()` 要求同时满足：

1. `GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED` ∈ `{1,true,yes,on}`
2. `VERIFY_SERVER_WORKERS_ENABLED` ∈ `{1,true,yes,on}`（compose `environment` 已固定为 `true`）
3. 不是 Vercel/serverless：`VERCEL_ENV` 为空且 `VERCEL != 1`

kick 只是「提前唤醒」，可靠性仍由持久化订单状态、租约、库存和重试 RPC 负责。
kick 内部失败不会抛回 webhook / status 请求，只会记结构化错误并等兜底 timer 重试。
同一订单并发 kick 会被 in-flight 去重，不会重复发货。

---

## 2. 硬限制

1. 游客购买改动只能从 `codex/guest-shop-cash-purchase`（或后续专用分支）提 PR 合并到最新 `main`；
   任何分支都不得执行 `npx vercel deploy --prod`。构建脚本在 `VERCEL_ENV=production` 且
   `VERCEL_GIT_COMMIT_REF != main` 时会主动阻断。
2. `/opt/zaoyoe-verify-server/.current-release` 等于目标 `main` commit 之前，不得安装或启动 worker。
3. 改 `.env` 后必须 `docker compose up -d --no-deps --force-recreate --no-build verify-server`
   才会重读 `env_file`。`docker restart`、`docker compose restart`、
   `systemctl restart zaoyoe-verify-server`（该单元不存在）都不算重载。
4. 密钥只写 `/opt/zaoyoe-verify-server/.env`，权限 `0600`。任何命令、审计输出、journal、
   聊天、监控标签都不得出现密钥值。
5. 不得复用 `CRON_SECRET` 或 `SUPABASE_SERVICE_ROLE_KEY` 作为 pepper 或 worker secret。
6. 不要把登录支付的 `ZPAY_PKEY` / `NOWPAYMENTS_API_KEY` 「顺手」从 Vercel 复制过来：
   游客 adapter 走 `resolvePaymentProviderSecrets`，优先读后台 stored secret，`.env` 只是回退。
7. worker 安装器固定 canonical root `/opt/zaoyoe-verify-server`，不得传 `--root` 或自定义 `KVM4_ROOT`。
8. 安装器默认只 enable timer，不启动。只有 secrets、端口、`/healthz` 全绿后才显式 `--start`。
9. 部署过程不执行 SQL、不打开游客商品/SKU、不批量重放死信。新 SQL 只写文件并给出绝对路径，交给用户。
10. `--fail-on-not-ready` 返回 `3` 是预期的 fail-closed 结果，不得用 `|| true` 绕过。
11. 紧凑版 verify 镜像可能不含 `deploy/kvm4/guest-shop-worker/*`，这不是启动失败；
    systemd unit 由 host 安装器落地，以 host 为准。

---

## 3. 部署顺序（唯一正确顺序）

统一变量（本机执行）：

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
SSH_KVM4=(ssh -i ~/.ssh/hostinger_sub2api -o ConnectTimeout=20 -p 2222 root@76.13.188.218)
MAIN_SHA=$(gh api repos/zaoyoe/Zaoyoe-Studio/commits/main --jq .sha)
echo "$MAIN_SHA"
```

> 本机 `git fetch origin` 走 GitHub SSH 时可能失败；需要刷新 `main` 时用只读 HTTPS：
> `git fetch https://github.com/zaoyoe/Zaoyoe-Studio.git main`。不要改远端配置。

### 步骤 1 — 确认发布来源

```bash
git log --oneline -1 FETCH_HEAD          # 应等于 $MAIN_SHA
gh pr list --state open --base main      # 不应有未合并的游客购买 PR
```

### 步骤 2 — 合并（仅在用户明确要求部署时）

```bash
gh pr create --base main --head codex/guest-shop-cash-purchase \
  --title "feat(shop): 游客购买即时发货" --body "..."
gh pr checks <PR>
gh pr merge <PR>
```

### 步骤 3 — 核对三条链路

```bash
gh run list --branch main --limit 9 --json name,status,conclusion,headSha
npx vercel inspect https://www.fatherkey.com | head -20
curl -fsS https://verify-api.fatherkey.com/healthz; echo
curl -fsS https://new.fatherkey.com/health; echo
```

期望：`Deploy KVM4 Verify Server`、`Deploy KVM4 Sub2API`、`Security Tests` 三条都
`completed / success` 且 `headSha == $MAIN_SHA`；Vercel `● Ready`；两个健康端点返回 200。

### 步骤 4 — KVM4 release 对齐（worker 的前置门槛）

```bash
"${SSH_KVM4[@]}" 'cat /opt/zaoyoe-verify-server/.current-release; cat /opt/sub2api/.current-release'
```

两个文件都必须等于 `$MAIN_SHA`。不相等就停在这里，不要安装或启动 worker。

### 步骤 5 — 密钥与开关（只看键名和长度，绝不打印值）

先跑 §4 的只读审计脚本确认缺什么。需要补键时：

```bash
# 备份（保持 0600），不要在命令行 echo 密钥（会进 shell history）
"${SSH_KVM4[@]}" 'mkdir -p /opt/zaoyoe-verify-server/backups && install -o root -g root -m 0600 \
  /opt/zaoyoe-verify-server/.env \
  /opt/zaoyoe-verify-server/backups/env.$(date -u +%Y%m%d%H%M%S).bak'

# 交互式编辑（服务器上生成值：openssl rand -hex 32）
"${SSH_KVM4[@]}" 'chmod 600 /opt/zaoyoe-verify-server/.env; ${EDITOR:-nano} /opt/zaoyoe-verify-server/.env'
```

游客购买需要的键（值必须是新生成的、≥32 字符、彼此不同）：

```
GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=true
GUEST_SHOP_WORKER_SECRET=
GUEST_SHOP_CLAIM_PEPPER=
GUEST_SHOP_CLAIM_DERIVATION_PEPPER=
GUEST_SHOP_CONTACT_HASH_PEPPER=
GUEST_SHOP_REQUEST_HASH_PEPPER=
```

可选（有明确需要再设）：`GUEST_SHOP_ORDER_TTL_SECONDS`、`GUEST_SHOP_PAYMENT_CREATE_LEASE_MS`、
`GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT`、`GUEST_SHOP_WEBHOOK_IP_LIMIT`、`GUEST_SHOP_ENABLED_PROVIDERS`、
`GUEST_SHOP_ZPAY_WEBHOOK_URL`、`GUEST_SHOP_NOWPAYMENTS_WEBHOOK_URL`。

注意：pepper 决定取货口令 HMAC。启用之后再轮换会让既有口令失配，必须按 runbook 处理，
所以只在启用前生成一次。`VERCEL_ENV` 在 `.env` 里必须为空或不出现，否则 kick 会被判定为
serverless 环境而关闭。

### 步骤 6 — 重载 env_file

```bash
"${SSH_KVM4[@]}" 'systemctl stop zaoyoe-kvm4-health-watchdog.timer zaoyoe-kvm4-health-watchdog.service'
"${SSH_KVM4[@]}" 'cd /opt/zaoyoe-verify-server && docker compose up -d --no-deps --force-recreate --no-build verify-server'
"${SSH_KVM4[@]}" 'sleep 5; curl -fsS http://127.0.0.1:3001/healthz; echo'
"${SSH_KVM4[@]}" 'systemctl start zaoyoe-kvm4-health-watchdog.timer'
```

`/healthz` 不通就不要继续，也不要启动 watchdog 之外的任何东西。

### 步骤 7 — readiness 闸门（本地）

```bash
npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid
```

本机没有 `server/.env.production` 时脚本会降级为只用进程环境变量并给出 warning，
此时以 §4 容器内检查为准。`--fail-on-not-ready` 返回 `3` 是预期结果（见 §2 第 10 条）。

### 步骤 8 — 安装 worker（默认只 enable，不 start）

```bash
npm run install:kvm4:guest-shop-worker -- --host 76.13.188.218 --port 2222 --key ~/.ssh/hostinger_sub2api
```

安装器会校验 `.env` 存在、unit 的 `ConditionPathExists` 与 `EnvironmentFile` 都指向
`/opt/zaoyoe-verify-server/.env`，并拒绝自定义 root。

### 步骤 9 — 只有步骤 4-8 全绿后才启动

```bash
npm run install:kvm4:guest-shop-worker -- --start --host 76.13.188.218 --port 2222 --key ~/.ssh/hostinger_sub2api
"${SSH_KVM4[@]}" 'systemctl is-enabled zaoyoe-guest-shop-worker.timer; systemctl is-active zaoyoe-guest-shop-worker.timer'
"${SSH_KVM4[@]}" 'systemctl list-timers --all --no-pager | grep zaoyoe-guest-shop-worker'
"${SSH_KVM4[@]}" 'journalctl -u zaoyoe-guest-shop-worker.service -n 20 --no-pager'
```

期望：`enabled` + `active (waiting)`，下次触发 ≤ 10 秒后，journal 无 503/超时。
出现 503 或超时：先 `systemctl stop zaoyoe-guest-shop-worker.timer`，再按 §6 排查。

### 步骤 8/9 的 CI 替代路径（本机 SSH 不可用时）

沙箱/代理环境常常只放行 HTTP(S)：TCP 能连上 `76.13.188.218:2222`，却收不到 SSH banner
（表现为 `Connection timed out during banner exchange`），本机 `ssh`/`scp` 全部不可用，
步骤 8、9 无法在工作站上执行。GitHub Actions runner 可以正常 SSH（部署工作流一直在用
`secrets.KVM4_SSH_PRIVATE_KEY`），因此改走 dispatch 工作流：

```bash
gh workflow run install-kvm4-guest-shop-worker.yml --field start_timer=true
gh run list --workflow install-kvm4-guest-shop-worker.yml --limit 1
gh run watch <run-id> --exit-status
```

`.github/workflows/install-kvm4-guest-shop-worker.yml` 做的事：

1. 把 checkout 钉到最新 `main`（并要求 `github.ref == refs/heads/main`）
2. **预检 fail-closed**：`.current-release` == main HEAD、`.env` 权限 0600、host `.env` 里
   `GUEST_SHOP_WORKER_SECRET` 长度 ≥32（只打印长度）、`zaoyoe-verify-server` healthy、
   无 `sub2api-legacy` 桥接容器、loopback `127.0.0.1:3001/healthz` 通、
   未授权探测 `/api/shop/guest/worker` 返回 **401**
   （503 = 容器内 worker 密钥不可用；404 = 该 release 没有这条路由）
3. 调用 canonical 安装器 `npm run install:kvm4:guest-shop-worker [--start]`，不传自定义 root
4. 证据：`is-enabled` / `is-active` / `list-timers`，再等 25 秒覆盖至少两次 tick，
   校验 `Result=success`、`ExecMainStatus=0`、`ExecMainStartTimestamp` 非空；
   任一不满足就 `systemctl stop` timer 并让工作流失败（fail-closed，不留半启动状态）

预检同时以 INFO 形式报告 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED` /
`VERIFY_SERVER_WORKERS_ENABLED` / `VERCEL_ENV` 的真假（不打印值）。
**timer 是 10 秒兜底路径，不依赖即时发货开关**；只有 1–3 秒 kick 路径要求
`GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=true` 且 `VERIFY_SERVER_WORKERS_ENABLED=true`
且 `VERCEL_ENV` 为空，判据见 `server/guest-shop-worker.js` 的
`isGuestShopImmediateFulfillmentEnabled()`。

---

## 4. 只读审计脚本（不打印任何密钥值）

```bash
"${SSH_KVM4[@]}" 'bash -s' "$MAIN_SHA" <<'AUDIT'
set -u
EXPECT="${1:-}"
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; }
chk()  { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }

echo "== release alignment =="
V=$(cat /opt/zaoyoe-verify-server/.current-release 2>/dev/null || echo MISSING)
S=$(cat /opt/sub2api/.current-release 2>/dev/null || echo MISSING)
echo "verify=$V"; echo "sub2api=$S"
if [ -n "$EXPECT" ]; then
  [ "$V" = "$EXPECT" ] && pass "verify .current-release == main" || fail "verify .current-release != main"
  [ "$S" = "$EXPECT" ] && pass "sub2api .current-release == main" || fail "sub2api .current-release != main"
fi

echo "== .env hygiene =="
chk ".env exists" "test -f /opt/zaoyoe-verify-server/.env"
MODE=$(stat -c '%a' /opt/zaoyoe-verify-server/.env 2>/dev/null || echo 000)
[ "$MODE" = "600" ] && pass ".env mode 0600" || fail ".env mode is $MODE (must be 600)"
echo "key names only:"
cut -d= -f1 /opt/zaoyoe-verify-server/.env 2>/dev/null | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' | sort -u | tr '\n' ' '; echo

echo "== worker units =="
chk "helper /usr/local/sbin/zaoyoe-guest-shop-worker" "test -x /usr/local/sbin/zaoyoe-guest-shop-worker"
chk "service unit" "test -f /etc/systemd/system/zaoyoe-guest-shop-worker.service"
chk "timer unit" "test -f /etc/systemd/system/zaoyoe-guest-shop-worker.timer"
echo "timer enabled: $(systemctl is-enabled zaoyoe-guest-shop-worker.timer 2>&1)"
echo "timer active:  $(systemctl is-active zaoyoe-guest-shop-worker.timer 2>&1)"
echo "watchdog timer active: $(systemctl is-active zaoyoe-kvm4-health-watchdog.timer 2>&1)"

echo "== containers =="
docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'zaoyoe|newapi|postgres|redis' | head -20
docker ps --format '{{.Names}}' | grep -qi 'sub2api-legacy' && fail "legacy bridge container running" || pass "no sub2api-legacy bridge"

echo "== health =="
curl -fsS -m 10 http://127.0.0.1:3001/healthz && echo || fail "local /healthz"

echo "== verify-server flags (values not printed) =="
docker exec zaoyoe-verify-server sh -c 'test "${GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED:-}" = "true" && echo "PASS  immediate_fulfillment=true" || echo "FAIL  immediate_fulfillment not true"'
docker exec zaoyoe-verify-server sh -c 'test "${VERIFY_SERVER_WORKERS_ENABLED:-}" = "true" && echo "PASS  workers_enabled=true" || echo "FAIL  workers_enabled not true"'
docker exec zaoyoe-verify-server sh -c 'test -z "${VERCEL_ENV:-}" && echo "PASS  VERCEL_ENV empty" || echo "FAIL  VERCEL_ENV set (kick disabled)"'
docker exec zaoyoe-verify-server sh -c 'n=${#GUEST_SHOP_WORKER_SECRET}; [ "$n" -ge 32 ] && echo "PASS  worker_secret length ok" || echo "FAIL  worker_secret missing or <32"'
docker exec zaoyoe-verify-server sh -c 'for k in GUEST_SHOP_CLAIM_PEPPER GUEST_SHOP_CLAIM_DERIVATION_PEPPER GUEST_SHOP_CONTACT_HASH_PEPPER GUEST_SHOP_REQUEST_HASH_PEPPER; do eval "v=\${$k:-}"; if [ ${#v} -ge 32 ]; then echo "PASS  $k length ok"; elif [ ${#v} -eq 0 ]; then echo "FAIL  $k missing"; else echo "FAIL  $k too short"; fi; done'

echo "== artifacts that must not exist =="
docker exec zaoyoe-verify-server sh -c 'test -e /tmp/worker-kick.log && echo "WARN  /tmp/worker-kick.log present (debug scaffolding, see spec §9.1)" || echo "PASS  no /tmp/worker-kick.log"'

echo "== recent worker evidence =="
journalctl -u zaoyoe-guest-shop-worker.service -n 6 --no-pager 2>&1 | tail -6
systemctl list-timers --all --no-pager 2>/dev/null | grep -E 'NEXT|zaoyoe' | head -6
echo "== AUDIT DONE =="
AUDIT
```

---

## 5. 验收：怎么证明「更快发货」

**不要**再用旧文档里的浏览器脚本读 `data.order.paid_at` / `data.order.delivered_at`：
公开 status 响应不返回这两个字段，脚本只会一直打印 `undefined`，得出「延迟 NaN」的假结论。
worker 侧使用的是 `fulfilled_at`。

正确证据（按可信度排序）：

```bash
# 1) verify 容器日志里的 kick / worker 记录
"${SSH_KVM4[@]}" "docker logs --since 30m zaoyoe-verify-server 2>&1 | grep -E 'GuestShopWorker|Immediate' | tail -40"

# 2) host journal 里的兜底 timer 执行结果
"${SSH_KVM4[@]}" "journalctl -u zaoyoe-guest-shop-worker.service --since '-30 min' --no-pager | tail -40"

# 3) 只读对账
npm run reconcile:guest-shop
```

4) 后台 Admin Studio → 商城 → 游客订单：比较单笔订单的支付确认时间与 `fulfilled_at`。

真实支付验证只能用**已单独批准的 sandbox / test SKU**。测试 SKU `¥0.01` 加 1% 通道手续费后
向上取整为 `¥0.02` 是预期；少付不会 confirm，也不会发货。验证过程不打开正式游客商品。

判定标准：

- webhook 或首次 `confirmed` 轮询 → `fulfillment_status=delivered` 通常 1-3 秒；
- 兜底路径 ≤ 10 秒 + 处理时间；
- 超过 30 秒未发货视为异常，按 §6 排查；
- 出现 `dead_letter` 只走后台「解锁死信」单笔处理，不从 journal 或后台批量重放。

---

## 6. 故障排查

| 症状 | 诊断 | 处理 |
|---|---|---|
| kick 从不触发 | §4 审计脚本的 flags 段 | 三个条件缺一不可；补 `.env` 后必须按步骤 6 force-recreate |
| 改了 `.env` 不生效 | `docker inspect --format '{{json .Config.Env}}' zaoyoe-verify-server \| cut -d, -f1`（只看是否存在，不要输出值） | 只有 `docker compose up -d --no-deps --force-recreate --no-build verify-server` 会重读 `env_file` |
| timer 从不执行 | `systemctl cat zaoyoe-guest-shop-worker.timer`；`systemctl start zaoyoe-guest-shop-worker.service` 手动跑一次看退出码 | 退出码 78 = `GUEST_SHOP_WORKER_SECRET` 缺失或 <32 位；`ConditionPathExists` 失败 = `.env` 不在 canonical root |
| worker 返回 503 / 超时 | `journalctl -u zaoyoe-guest-shop-worker.service -n 50`；`curl -fsS http://127.0.0.1:3001/healthz` | 先 `systemctl stop zaoyoe-guest-shop-worker.timer`，修好 verify 再启动；不要放宽 SKU |
| 容器不健康 | `docker compose -f /opt/zaoyoe-verify-server/docker-compose.yml ps`；`docker logs --tail 200 zaoyoe-verify-server`；`docker inspect --format '{{json .State.Health}}' zaoyoe-verify-server` | 按日志定位；不要在宿主机 `node server/index.js` 手工起服务 |
| 端口 3001 | `ss -ltnp \| grep 3001` | 预期只有 `127.0.0.1:3001`（compose 绑定），公网入口是 Caddy → `verify-api.fatherkey.com`。禁止 `kill -9 $(lsof -ti:3001)` |
| SSH 握手即断：`kex_exchange_identification: Connection closed by remote host` | 远端限速 / fail2ban | 按 15-25 秒间隔重试最多 4-8 次（`scripts/deploy-kvm4-verify-server.sh` 内置同样重试）。连续爆破式重试会延长封禁；必要时走 Hostinger 面板控制台 |

---

## 7. 回滚

1. **游客购买回滚 = 后台关闭游客商品 / SKU 开关**。不是数据库回滚，也不是 Vercel-only 回滚；
   回滚 verify release 本身不会退款或撤销已发货订单。
2. 只回滚履约链路：`systemctl stop zaoyoe-guest-shop-worker.timer`（保留 unit 与 helper），
   或把 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED` 置 `false` 后按步骤 6 force-recreate。
3. verify release 回滚：只在本地干净 `main` 上用 `npm run rollback:kvm4:verify`。
4. Vercel 紧急回滚：`npx vercel rollback <deployment-url-or-id> --yes`。
5. 常规回滚不要 `rm /etc/systemd/system/zaoyoe-guest-shop-worker.*`；先 stop + disable，
   确认无需保留后再删，并 `systemctl daemon-reload`。

---

## 8. 部署记录模板

```markdown
## 游客购买履约链路部署记录

- 日期 / 执行人：
- main commit：
- Vercel production deployment id / 状态：
- Deploy KVM4 Verify Server run id / 结论：
- Deploy KVM4 Sub2API run id / 结论：
- KVM4 verify `.current-release`：
- KVM4 sub2api `.current-release`：
- `.env` 权限 / 键名清单（无值）：
- 容器内三条件（immediate / workers / VERCEL_ENV 空）：
- worker timer：enabled=? active=? 下次触发=?
- 审计脚本输出（PASS/FAIL 汇总）：
- 验证方式：[ ] sandbox SKU 真实支付  [ ] 只读对账  [ ] journal 证据
- 支付确认 → fulfilled_at 实测：____ 秒（样本数 __）
- 是否触碰商品/SKU 开关：否（必须为否）
- 是否执行 SQL：否（必须为否）
- 遗留问题 / 后续行动：
```

---

## 9. 已知遗留问题处理状态（2026-09-17 复核）

处理分支：`codex/guest-shop-instant-delivery-cleanup`（PR 编号与合并结果记入 §8 部署记录）。

1. **kick 里的调试脚手架**（`server/guest-shop-worker.js`，随 PR #648 进入 `main`）：**已修**。
   移除每次 kick 的同步 `appendFileSync('/tmp/worker-kick.log')`（容器内无轮转、阻塞式写落在
   请求路径上，与「降延迟」目标相反）与 emoji `console.log`；`inFlight` 去重提前到任何日志之前
   （已确认订单会被每次 status 轮询重复 kick，日志量不能随买家轮询放大）；跟踪日志改走仓库
   结构化 logger，由新增开关 `GUEST_SHOP_IMMEDIATE_FULFILLMENT_DEBUG` 控制，**默认关闭**，
   不再写任何文件。容器内若仍存在 `/tmp/worker-kick.log`（§4 审计脚本的 WARN 项），说明该容器
   仍在跑修复前的 commit；需等本分支合并 + verify 重新发布后才会消失。该文件不在挂载卷上，
   可安全删除。
2. **根目录 `deploy.sh`**：**已删除**。原脚本执行 `git add -A && git commit && git push origin <当前分支>`
   并给出 `pm2 restart all`、`tail -f /tmp/worker-kick.log` 等错误指引，与 AGENTS.md 的
   PR → `main` → 自动部署流程冲突。历史版本：`git show 2a0ce1963:deploy.sh`。
3. **根目录 6 份草稿文档**（`DEPLOYMENT_IMMEDIATE_FULFILLMENT.md`、`GUEST_SHOP_OPTIMIZATION_PROPOSAL.md`、
   `GUEST_SHOP_SMART_POLLING_PATCH.md`、`PHASE2_PHASE3_IMPLEMENTATION.md`、`SMART_POLLING_IMPLEMENTATION.md`、
   `WORKER_DEBUG_GUIDE.md`）：**已归档**到 `docs/archive/2026-09-instant-fulfillment-drafts/`，
   目录 README 逐条标注了其中禁止执行的命令，避免其他 Agent 当成执行依据。
   `guest-shop-diagnostics.js` 是只读诊断工具，保留在根目录。
4. **`.freebuff/project-id`**：**已移出版本库**并加入 `.gitignore`（本地文件保留给工具使用）。
5. **本机未跟踪草稿**：`kvm4-deployment-guide.md`、`DEPLOYMENT_STEPS.md`、`kvm4-env-template.txt`、
   `deploy-guest-shop-worker.sh` 已按本规范修正或降级为指针，不要再按旧版本执行。
6. **KVM4 SSH 未通过**：本次复核期间 `ssh -p 2222 root@76.13.188.218` 在密钥交换阶段被远端关闭
   （`kex_exchange_identification: Connection closed` / banner 超时），疑似 fail2ban 或连接限速，
   因此 §0 表中「KVM4 `.current-release`」「容器内开关」「worker timer」三行仍未验证。
   处理方式见 §6 最后一条；这是当前唯一未闭环的核对项。
   **补充结论**：复测确认 TCP 可连通但永远收不到 banner（`github.com:22` 同样挂起），
   即本机所在沙箱只放行 HTTP(S)，与 KVM4 侧 fail2ban 无关。此环境下不要再重试 SSH，
   改用 §3「步骤 8/9 的 CI 替代路径」由 Actions runner 执行安装与审计。

---

## 10. 参考

- `AGENTS.md` → Guest Shop Deployment Rules
- `docs/kvm4-verify-server-deploy.md` → Guest Shop Worker（硬规则、密钥重载、安装、验证）
- `docs/guest-shop-payment-fulfillment-runbook.md` → 发布≠启用、stored secrets、退款/补发/解锁死信
- `docs/guest-purchase-task-2.0.md` → 启用条件（Task 2.0 完成标准）
- `deploy/kvm4/docker-compose.verify-server.yml`、`deploy/kvm4/guest-shop-worker/*`、`deploy/kvm4/watchdog/*`
- `.github/workflows/install-kvm4-guest-shop-worker.yml` → 本机 SSH 不可用时的 CI 安装路径（仅 workflow_dispatch）
- `scripts/install-kvm4-guest-shop-worker.sh`、`scripts/guest-shop-readiness.js`、`scripts/guest-shop-reconcile.js`
- `server/guest-shop-worker.js`、`server/api-handlers/public/guest-shop.js`、`api/public.js`

---

**文档版本：** 2.0 ｜ **最后更新：** 2026-09-17 ｜ **适用环境：** KVM4 `76.13.188.218:2222`，root `/opt/zaoyoe-verify-server`
