# 任务 2.0 阶段 D：真实支付沙箱验收表

> 执行合同：[`docs/guest-purchase-task-2.0.md`](./guest-purchase-task-2.0.md)  
> 当前状态：`in_progress`（D3-01/D3-13/D3-17/D3-04/D3-03/D3-02/D3-05/D3-06/D3-07/D3-20/D3-11/D3-12/D3-10/D3-19/D3-18/D3-14/D3-15/D3-09 PASS；D3-08 BLOCKED+ZPay currency is site-derived；INTL 成功支付改由用户在 ?site=intl 自建 USDT-BEP20 并真付；07:12 CST 只读复核 available=41/sold=1/held=0，无新单；D3-16 未开始；总进度仍 48%）  
> 禁止：mock 支付、把空白行当成 PASS、写入卡密 / claim token / `recovery_code` / 支付密钥

## 解除 blocked 还缺什么

- [x] 20260914 SQL verify 5/5 PASS
- [x] 专用分支按 AGENTS.md 合入 `main`，Vercel + KVM4 Verify 发布该 commit（发布 ≠ 启用游客商品）
- [x] CN ZPay：无独立沙箱，现网 `zpayz.cn` + 支付宝 ¥0.01
- [x] INTL NOWPayments：无独立沙箱，现网 `api.nowpayments.io` / `usdtbsc`；20260916 已 3/3 PASS。测试 SKU 已涨到 144，错网络 PASS；成功支付发票 `5250755581` 已 expired 且 `actually_paid=0`，不要付旧地址
- [x] 可被主线程看见的浏览器：Codex IAB `http://localhost:8000/shop.html`
- [x] 仅一个内部测试 SKU 打开 `allow_guest_purchase`：Gemini「测试 2」；公开商品保持关闭

## 证据字段

每行必须填：

`案例ID | 站点 | 渠道 | 本站订单号 | provider 订单号 | 事件键 | 金额/币种 | 期望状态 | 实际状态 | PASS 或 BLOCKED+原因`

## D2 渠道最低集

| 案例ID | 覆盖 | 状态 |
| --- | --- | --- |
| D2-CN-ZPAY | CN × ZPay：成功、未付过期、假回调、重复回调、退款成功/失败 | 部分：成功+未付过期+假回调+重复回调+乱序回调+少付+多付+充值/游客隔离+超时409+未知结果review+回调丢失补偿+关SKU新单拒绝+退款成功 PASS；错币种 BLOCKED+ZPay currency is site-derived；退款失败/悬挂未开始 |
| D2-INTL-NOW | INTL × NOWPayments `usdtbsc`：成功、错网络、金额或币种不匹配、回调丢失补偿 | 部分：错网络 PASS（`GS20260915150703326FB1F73A265FA` / `usdttrc20` 202 `{accepted:false}`）；成功支付未入账（官方 expired / actually_paid=0，需重建发票）；金额或币种不匹配/回调丢失补偿未开始 |
| D2-CROSS | CN 回调打 INTL 订单、INTL 回调打 CN 订单，均拒绝且不发货 | PASS：NOWPayments 打 D3-01、ZPay 打 INTL 失败单均 live HTTP 202 `{accepted:false}`；rejected 事件 `payment_order_id=null`；未 confirm、未发货；SKU available=41 / sold=1 |

## D3 场景

| 案例ID | 场景 | 站点 | 渠道 | 本站订单号 | provider 订单号 | 事件键 | 金额/币种 | 期望状态 | 实际状态 | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D3-01 | 正常下单并支付成功 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 577d818d-0342-41f8-b53e-4603c5286679 | 0.01 CNY | 已确认并履约 | 支付 confirmed / 订单 delivered / 预占 consumed / 库存 sold / 浏览器已发货 | PASS |
| D3-02 | 未付款订单过期并释放预占 | cn | ZPay/alipay | GS202609150429213472D4D87B04A50 | GS202609150429213472D4D87B04A50 | 无支付事件 | 0.01 CNY | 预占释放，库存回到 available | worker 200 `expired_reservations=1`；预占 released/expired；库存 available；SKU available=41 / sold=1；D3-01 仍 delivered/sold | PASS |
| D3-03 | 假回调 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 43b073b9-0ad8-4c5e-88fc-e9c73cb979e4 / zpay:invalid-bucket | 0.01 CNY | 拒绝，不发货 | HTTP 202 `{accepted:false}`；rejected + signature_verified=false；原 processed 事件不变；delivered/consumed/sold 不变 | PASS |
| D3-04 | 重复回调 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 577d818d-0342-41f8-b53e-4603c5286679 / zpay:2026091523001409501422068607:paid:e566e673d99deadba2094ad2 | 0.01 CNY | 幂等，不重复发货 | HTTP 200 `{duplicate:true}`；事件仍 1 条 processed；delivered/consumed/sold 不变；SKU sold=1 available=41 | PASS |
| D3-05 | 乱序回调 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 27ed9756-e976-4fcd-91aa-83d8e7ccaa19 / zpay:invalid-bucket | 0.01 CNY / WAIT_BUYER_PAY | 终态正确，不发错货 | HTTP 202 `{accepted:false}`；新事件 rejected + signature_verified=true + final_status_verified=false；原 processed 事件不变；delivered/consumed/sold 不变 | PASS |
| D3-06 | 少付 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 18552844-665c-40ef-a057-ec6b8a08107b / zpay:invalid-bucket | 0.00 vs expected 0.01 CNY | 不发货，进入金额异常/review | HTTP 202 `{accepted:false}`；新事件 rejected + amount_verified=false + observed_amount=0；支付单 paid_amount 仍 0.01；delivered/consumed/sold 不变 | PASS |
| D3-07 | 多付 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 75bcb4c4-ee17-4fdf-9495-bb6f9e5778f3 / zpay:invalid-bucket | 1.00 vs expected 0.01 CNY | 不按错误金额发货 | HTTP 202 `{accepted:false}`；新事件 rejected + amount_verified=false + observed_amount=1；支付单 paid_amount 仍 0.01；delivered/consumed/sold 不变 | PASS |
| D3-08 | 错币种 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | 未打 live webhook | 无新事件；in-process 对照会 confirm | payload USD vs site-derived CNY | 拒绝，不发货 | 渠道无法独立表达错币种：parser/binding/quote 均把 ZPay 币种写成 CNY；金额正确+USD 会被 200 接受。真实错币种放到 INTL NOWPayments | BLOCKED+ZPay currency is site-derived |
| D3-09 | 错网络（NOWPayments 非 `usdtbsc`） | intl | NOWPayments | GS20260915150703326FB1F73A265FA | payment_id=5250755581 | af1ad08a-818a-418b-bd53-4c319e03b02f / nowpayments:invalid-bucket | 144 CNY / 应付 20.48 usdtbsc；错网络 usdttrc20 | 拒绝，不发货 | 涨价后 live create HTTP 201；错网络 webhook HTTP 202 `{accepted:false}`；rejected / observed_status=wrong_asset；未 confirm、未发货；预占 held；库存 reserve；sold 仍 1。旧 ¥0.01 单 GS20260915095329434CB3A9D9F6DAE 只作历史对照 | PASS |
| D3-10 | 回调丢失后对账补偿 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 577d818d-0342-41f8-b53e-4603c5286679 / zpay:2026091523001409501422068607:paid:e566e673d99deadba2094ad2 | 0.01 CNY | 补偿后确认，不重复扣款 | 现网支付宝已付后官方查单 paid/trade_no 存在，本地 webhook 当时未到；用官方字段+商户签名补进本地验签事件 → confirmed → worker delivered。D3-04 同事件 duplicate。processed 事件仍 1。D3-02/两张超时单渠道 pending 且无 trade_no，不得补偿确认。SKU available=41 / sold=1 | PASS |
| D3-11 | provider 超时 | cn | ZPay/alipay | GS20260915070900686E811B0791BB0 | 无 provider_order_no；hang log 仅 1 次 zpayz.cn CONNECT | 无支付事件 | 0.01 CNY | 租约期内不第二次下单 | request2=409 `guest_payment_creation_in_progress`；request1 无 checkout；旧单 `GS202609150642336739E865BD005BA` 只作 409 对照 | PASS |
| D3-12 | provider 结果未知进入 `review` | cn | ZPay/alipay | GS20260915070900686E811B0791BB0 | 无 provider_order_no / 无 checkout | 无支付事件 | 0.01 CNY | 订单+支付行 review，再重试 503，不重复扣款 | 修 `markPaymentCreationReview` 后真实超时：订单行+支付行 `review`/`payment_creation_unknown`；request3=503；预占 held；库存 reserve；D3-01 delivered 不变。旧单订单行仍 pending，不得当 PASS | PASS |
| D3-13 | 支付成功后 worker 履约 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 577d818d-0342-41f8-b53e-4603c5286679 | 0.01 CNY | delivered，可取货 | 本地 worker scanned=1 processed=1 delivered=1；fulfilled_at=2026-09-15T03:42:28.412784Z | PASS |
| D3-14 | 支付成功但库存耗尽 | cn | ZPay/alipay | GS20260915131639759F6E8976B5F06 | GS20260915131639759F6E8976B5F06 / trade_no=2026091523001409501430682610 | ab1eddd3-1a6d-4eda-b2be-073352cec4cf / zpay:2026091523001409501430682610:paid:de00b3e7421ada0536d32f1b | 0.01 CNY | `paid_unfulfillable` / 不发货 / 不重新预占 | webhook 后：payment=confirmed / fulfillment=paid_unfulfillable / refund=pending / reservation=released / last_error=paid_inventory_not_reservable；库存 frozen 41 / sold 1，sold 仍 D3-01；worker delivered=0。TTL 已过后 late-success，未重新预占 | PASS |
| D3-15 | 退款成功（paid_unfulfillable 自动退款） | cn | ZPay/alipay | GS20260915131639759F6E8976B5F06 | GS20260915131639759F6E8976B5F06 / trade_no=2026091523001409501430682610 | 沿用 D3-14 processed 事件，未新发货事件 | 0.01 CNY | refund succeeded | worker scanned=1 / refunded=1 / delivered=0；终态 payment=refunded / fulfillment=refunded / refund_status=succeeded；官方查单 status=2 refunded / money=0.01；库存仍 frozen 41 / sold 1；D3-01 仍 delivered。触发是 worker 自动退款，不是 Admin request_refund，也未退 D3-01 | PASS |
| D3-16 | 退款失败/悬挂 |  |  |  |  |  |  | 保持不可领取，可追踪 |  | 未开始 |
| D3-17 | 跨设备恢复 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 | 577d818d-0342-41f8-b53e-4603c5286679 | 0.01 CNY | 同一口令可找回，不回吐口令 | 设备 cookie 403 后用弹窗口令找回；页面已发货；recover 响应不含 recovery_code | PASS |
| D3-18 | 关闭测试 SKU 后旧单仍可履约/退款，新单拒绝 | cn+intl | Admin Studio upsert_product / ZPay+NOWPayments create-order 探测 | GS2026091500585007432D22B143D38（旧单）/ 无新单 | 无新 provider 单 | 无新事件；旧 processed `577d818d-0342-41f8-b53e-4603c5286679` 不变 | 0.01 CNY 未改账 | 新单 409，旧单继续 | mutate_off 200 `allow_guest_purchase=false` / guestProductCount=0；CN/INTL create 均 409 `guest_product_unavailable`，无 order/recovery_code/checkout；D3-01 仍 confirmed/consumed/delivered/sold；SKU available=41 / sold=1 不变；mutate_on 恢复 true。未退 D3-01 | PASS |
| D3-19 | CN / INTL 串单隔离 | cn↔intl | NOWPayments→CN ZPay / ZPay→INTL NOWPayments | GS2026091500585007432D22B143D38 / GS20260915095329434CB3A9D9F6DAE | 不绑定支付行 | 6ab2dd4c-9abb-4c80-891f-2e1a4d071480 / nowpayments:invalid-bucket ；6117d4ae-832a-4d9c-b6c2-f52bd0563827 / zpay:invalid-bucket | 0.01 CNY 标价未改账 | 拒绝跨站回调 | 两向 live HTTP 202 `{accepted:false}`；rejected / `payment_order_id=null` / 不 confirm；D3-01 仍 delivered/sold / paid_amount=0.01；INTL 仍 payment=failed / reservation=released；SKU available=41 / sold=1；原 processed 事件不变。handler 跨 provider 命中不再绑支付行，避免 P0001 | PASS |
| D3-20 | 充值回调不给游客单发货；游客回调不加积分 | cn | ZPay/alipay | GS2026091500585007432D22B143D38 | GS2026091500585007432D22B143D38 / ZPA6A4FEC49A2FBBCF29BCA108546C30 | 25be3fb8-841a-4955-927c-f4145283dd9e / zpay:invalid-bucket | 0.01 CNY guest / 0.02 recharge | 两条链路互不串账 | guest→recharge HTTP 503 `payment order not ready`，points_ledger 0 条；recharge→guest HTTP 202 `{accepted:false}` rejected / `payment_order_id=null`；D3-01 仍 delivered；充值单仍 redeemed | PASS |

## 完成标准

每一行都是 `PASS` 或 `BLOCKED+原因`。不允许空白。任何一行用 mock 顶替，阶段 D 不得标记完成。

## D3-01 创建记录（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY
- 本站订单号 / provider 订单号：`GS2026091500585007432D22B143D38`
- checkout host：`qr.alipay.com`
- 取货口令只在浏览器弹窗显示一次，不写入本表
- 证据位置：本地 preview 日志/数据库只读核对 + Codex 可见浏览器弹窗

## D3-01 支付确认与履约阻断（2026-09-15）

- 现网支付宝已付 ¥0.01；ZPay 官方查单 `status=paid` / `trade_no=2026091523001409501422068607`
- 支付单 `152be175-4c1b-4d40-8236-2b25d6e39dbc`：`status=confirmed`，`paid_amount=0.01`，`paid_at=2026-09-15T01:48:46.722452Z`
- 事件 `577d818d-0342-41f8-b53e-4603c5286679`：`signature_verified=true`，`processing_status=processed`，`observed_status=paid`
- 订单 `6b31e1b4-ef71-47ab-979d-26e6ee4e0cda`：`payment_status=confirmed`，`fulfillment_status=dead_letter`，`last_error_code=42702`（`column reference "fulfillment_status" is ambiguous`）
- 预占 `338d689e-313a-4953-b307-bbc7c27e57ee` 仍 `held`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 `reserve` / `is_shared=false`
- TTL / 预占 / 支付过期已延长到 `2026-09-15T06:00:00Z`
- 结果：`BLOCKED+42702 fulfillment_status ambiguous`。20260917 已落地且 verify 4/4 PASS，但仍不够；20260918 落地前不解锁、不跑 worker、不记 PASS

## D3-01 20260917 不足与 20260918（2026-09-15）

- 20260917 verify 4/4 PASS，只证明 RETURN QUERY 已加表别名
- 官方 unlock RPC 同样 42702；等价解锁后生产 worker 抢跑 claim，成功路径 SET-clause CASE 再次 42702，订单重新 `dead_letter`
- 最新热修：`supabase/migrations/20260918_guest_shop_qualify_update_set_status_columns.sql`
- 只读核对：`supabase/migrations/20260918_verify_guest_shop_qualify_update_set_status_columns.sql`
- 20260918 落地前保持：支付 confirmed，履约 dead_letter，预占 held，库存 reserve，TTL `2026-09-15T06:00:00Z`

## D3-01 20260918 落地后 claim 消耗库存，mark_fulfilled 再 42702（2026-09-15）

- 20260918 verify 6/6 PASS，只证明 UPDATE SET CASE 已限定
- 官方 unlock 成功；本地 worker 200：claim 把预占 `338d689e-313a-4953-b307-bbc7c27e57ee` 改为 consumed，库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 改为 sold
- `fn_guest_shop_mark_fulfilled` 失败：`last_error_code=42702`，`column reference "order_id" is ambiguous`
- 订单 `6b31e1b4-ef71-47ab-979d-26e6ee4e0cda` 重新 `fulfillment_status=dead_letter`，`fulfilled_at=null`
- 最新热修：`supabase/migrations/20260919_guest_shop_qualify_where_out_columns.sql`
- 只读核对：`supabase/migrations/20260919_verify_guest_shop_qualify_where_out_columns.sql`
- 20260919 落地前保持：支付 confirmed，履约 dead_letter，预占 consumed，库存 sold；不解锁、不跑 worker、不记 PASS

## D3-01 20260919 落地后 unlock + worker delivered（2026-09-15）

- 用户执行 20260919，verify 6/6 PASS
- 官方 unlock：履约 `dead_letter → failed`，worker metadata `retry_waiting` / attempt=0
- 本地 worker 200：`scanned=1 processed=1 delivered=1 dead_lettered=0`（`guest-shop-worker:31132`）
- 订单 `6b31e1b4-ef71-47ab-979d-26e6ee4e0cda`：`fulfillment_status=delivered`，`fulfilled_at=2026-09-15T03:42:28.412784Z`，`last_error_code=null`
- 预占仍 consumed，库存仍 sold / 非共享；支付单仍 confirmed 0.01 CNY
- 浏览器：查询状态因设备 cookie 403；口令找回后显示「支付已确认，订单已发货。」发货面板可见
- 结果：D3-01 PASS；同期覆盖 D3-13、D3-17。阶段 D 未完成


## D3-04 重复回调（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY
- 本站订单号 / provider 订单号：`GS2026091500585007432D22B143D38`
- 重放对象：已处理事件 `577d818d-0342-41f8-b53e-4603c5286679`
- 入口：本地 preview `POST /api/shop/guest/webhooks/zpay`
- 结果：200 `{ success: true, accepted: true, duplicate: true }`；`body_sha256` 与原事件一致
- 终态未变：支付 confirmed、履约 delivered、预占 consumed、库存 sold；`fulfilled_at` 仍为 `2026-09-15T03:42:28.412784Z`
- 未新扣款、未新插事件、未再消耗库存
- 禁止写入：卡密、口令、支付密钥、原始签名


## D3-03 假回调（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY
- 目标订单：`GS2026091500585007432D22B143D38`（已 delivered，不作为发货对象）
- 入口：本地 preview `POST /api/shop/guest/webhooks/zpay`，伪造 `sign`
- 结果：202 `{ success: true, accepted: false }`
- 新事件 `43b073b9-0ad8-4c5e-88fc-e9c73cb979e4` 进入 invalid-bucket，`rejected` / `guest_webhook_verification_failed`
- 原事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 processed；订单/预占/库存终态不变
- 禁止写入：伪造或真实签名原文、卡密、口令、支付密钥

## D3-02 未付款过期（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY；**未付款**
- 本站订单号 / provider 订单号：`GS202609150429213472D4D87B04A50`
- 订单 id：`e59d7bc1-b182-4a46-9c68-7b505e1197bf`
- 预占 `4c93bd92-2b91-41f1-a145-da48b7a35c8b`：`held → released`，`release_reason=expired`，`released_at=2026-09-15T04:35:12.329282Z`
- 库存 `0ac8f64a-bf2a-4df9-99ee-819e8908d018`：`reserve → available` / 非共享
- 支付单 `818e4efb-ede8-4224-bd0c-e0aa68867bcd` 仍 `created`，expected 0.01，未确认
- 官方 worker：本地 preview `POST /api/shop/guest/worker`（无 body）200，`expired_reservations=1`，`scanned=0 processed=0 delivered=0`
- D3-01 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；订单仍 delivered
- 禁止写入：卡密、口令、worker secret、支付密钥

## 20260916 INTL 积分价回退（2026-09-15）

- 用户已执行 [20260916_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_guest_shop_intl_credit_fallback.sql) 与 [20260916_verify_guest_shop_intl_credit_fallback.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260916_verify_guest_shop_intl_credit_fallback.sql)
- verify 3/3 PASS：`intl_fallback_helper_present` / `intl_fallback_helper_grants` / `intl_missing_points_reuse_cn`
- INTL create-order 闸门已解除；本轮未创建 INTL 订单、未扣款
- 禁止重跑 20260913–20260919

## D3-05 乱序回调（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY
- 目标订单：`GS2026091500585007432D22B143D38`（已 delivered，不作为发货对象）
- 入口：本地 preview `POST /api/shop/guest/webhooks/zpay`
- 操作：用真实商户密钥重签，把 `trade_status` 从 `TRADE_SUCCESS` 改成 `WAIT_BUYER_PAY`
- 结果：202 `{ success: true, accepted: false }`
- 新事件 `27ed9756-e976-4fcd-91aa-83d8e7ccaa19` 进入 invalid-bucket，`rejected` / `observed_status=pending` / `signature_verified=true` / `amount_verified=true` / `currency_verified=true` / `final_status_verified=false` / `guest_webhook_verification_failed`
- 原事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 processed / paid；订单仍 `confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784Z`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；SKU available=41 / sold=1
- D3-02 `GS202609150429213472D4D87B04A50` 仍 released / available，未被碰到
- 证据：`/tmp/d3-05-out-of-order-evidence.json`
- 禁止写入：卡密、口令、支付密钥、原始签名

## D3-06 少付（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，期望金额 0.01 CNY
- 目标订单：`GS2026091500585007432D22B143D38`（已 delivered，不作为发货对象）
- 入口：本地 preview `POST /api/shop/guest/webhooks/zpay`
- 操作：用真实商户密钥重签，把 `money` 从 `0.01` 改成 `0.00`，保持 `TRADE_SUCCESS`
- 结果：202 `{ success: true, accepted: false }`
- 新事件 `18552844-665c-40ef-a057-ec6b8a08107b` 进入 invalid-bucket，`rejected` / `observed_status=paid` / `observed_amount=0` / `signature_verified=true` / `amount_verified=false` / `currency_verified=true` / `final_status_verified=true` / `guest_webhook_verification_failed`
- 原事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 processed / observed_amount=0.01；支付单 `152be175-4c1b-4d40-8236-2b25d6e39dbc` 仍 confirmed / paid_amount=0.01
- 订单仍 `confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784Z`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；SKU available=41 / sold=1
- D3-02 仍 released / available，未被碰到
- 证据：`/tmp/d3-06-underpay-evidence.json`
- 禁止写入：卡密、口令、支付密钥、原始签名

## D3-07 多付（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，期望金额 0.01 CNY
- 目标订单：`GS2026091500585007432D22B143D38`（已 delivered，不作为发货对象）
- 入口：本地 preview `POST /api/shop/guest/webhooks/zpay`
- 操作：用真实商户密钥重签，把 `money` 从 `0.01` 改成 `1.00`，保持 `TRADE_SUCCESS`
- 第一次与 D3-06 同一 5 分钟 invalid-bucket，返回 202 `{accepted:false, code:event_key_body_conflict}`，终态未变
- 下一 bucket 重放结果：202 `{ success: true, accepted: false }`
- 新事件 `75bcb4c4-ee17-4fdf-9495-bb6f9e5778f3` 进入 invalid-bucket `5964832`，`rejected` / `observed_status=paid` / `observed_amount=1` / `signature_verified=true` / `amount_verified=false` / `currency_verified=true` / `final_status_verified=true` / `guest_webhook_verification_failed`
- 原事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 processed / observed_amount=0.01；支付单 `152be175-4c1b-4d40-8236-2b25d6e39dbc` 仍 confirmed / paid_amount=0.01
- 订单仍 `confirmed` / `consumed` / `delivered` / `none`；`fulfilled_at=2026-09-15T03:42:28.412784Z`
- 库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；SKU available=41 / sold=1
- D3-02 仍 released / available，未被碰到
- 证据：`/tmp/d3-07-overpay-evidence.json`、`/tmp/d3-07-overpay-verdict.json`
- 禁止写入：卡密、口令、支付密钥、原始签名

## D3-10 回调丢失后对账补偿（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY
- 本站订单号 / provider 订单号：`GS2026091500585007432D22B143D38`
- 事件键：`577d818d-0342-41f8-b53e-4603c5286679` / `zpay:2026091523001409501422068607:paid:e566e673d99deadba2094ad2`
- 正例：现网支付宝已付后 ZPay 官方查单 `status=paid` / `trade_no=2026091523001409501422068607`；本地 webhook 当时未到，用官方字段 + 商户签名补进本地验签事件。支付 confirmed，worker delivered，`fulfilled_at=2026-09-15T03:42:28.412784Z`
- D3-04 已把同一事件重放成 HTTP 200 `{duplicate:true}`，未二次发货；processed 事件仍 1
- 现网查单此刻仍 paid / amount=0.01 / merchant_order_no 匹配；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold / 非共享；SKU available=41 / sold=1
- 反例不得补偿确认：D3-02 `GS202609150429213472D4D87B04A50`、旧超时 `GS202609150642336739E865BD005BA`、D3-12 `GS20260915070900686E811B0791BB0` 渠道均为 pending 且无 trade_no
- 证据：`/tmp/d3-10-evidence.json`（`verdict.pass=true`，`at=2026-09-15T07:40:13.955Z`）
- 禁止写入：卡密、口令、支付密钥、原始签名
- 结果：PASS。不是 mock，也没有再扣第二笔 ¥0.01

## D3-19 串单隔离（2026-09-15）

- 覆盖：INTL NOWPayments 回调打 CN ZPay 已付单；CN ZPay 回调打 INTL NOWPayments 失败单。均须拒绝且不发货
- 入口：本地 preview `POST /api/shop/guest/webhooks/nowpayments` 与 `POST /api/shop/guest/webhooks/zpay`；cloudflared **20601** 未杀
- 第一轮 live 两向 HTTP 500 `P0001`：lookup 只按 `merchant_order_no`，rejected 事件仍带着对方 `payment_order_id`，触发器拒绝跨 provider 写事件。DB 挡住了发货，但合同要 202 + rejected
- 修正：`server/api-handlers/public/guest-shop.js` 跨 provider 命中当成未知单，`payment_order_id=null`，永不 confirm。契约测试 11/11 PASS
- 重启 preview PID **17884** 后重打：
  - NOWPayments HMAC-SHA512 valid → D3-01 `GS2026091500585007432D22B143D38`：HTTP 202 `{accepted:false}`；新事件 `6ab2dd4c-9abb-4c80-891f-2e1a4d071480` / `nowpayments:invalid-bucket` / rejected / `payment_order_id=null` / `signature_verified=true`
  - ZPay MD5 valid `TRADE_SUCCESS 0.01 CNY` → INTL `GS20260915095329434CB3A9D9F6DAE`：HTTP 202 `{accepted:false}`；新事件 `6117d4ae-832a-4d9c-b6c2-f52bd0563827` / `zpay:invalid-bucket` / rejected / `payment_order_id=null` / `signature_verified=true`
- D3-01 仍 `confirmed` / `consumed` / `delivered`；库存 `052c5e12-7d10-496b-b610-2a74139dcc1f` 仍 sold；paid_amount 仍 0.01；原事件 `577d818d-0342-41f8-b53e-4603c5286679` 仍 processed
- INTL 订单仍 pending/released；支付行 `0c5cec8b-45b7-44c3-a629-5cc2b1e9f9c6` 仍 failed / `guest_provider_create_failed` / 无 `provider_order_no`
- SKU available=41 / sold=1；D3-02 仍 released
- 证据：`/tmp/d3-19-isolation-evidence.json`、`/tmp/d3-19-isolation-verdict.json`（`status=PASS`，`failed=[]`）
- 禁止写入：卡密、口令、支付密钥、原始签名
- 结果：PASS。不是 mock，也没有再扣款、没有发货

## D3-14 库存耗尽 late-success（2026-09-15）

- 站点 cn，渠道 ZPay/alipay，金额 0.01 CNY
- 本站订单号 / provider 订单号：`GS20260915131639759F6E8976B5F06` / `trade_no=2026091523001409501430682610`
- 事件键：`ab1eddd3-1a6d-4eda-b2be-073352cec4cf` / `zpay:2026091523001409501430682610:paid:de00b3e7421ada0536d32f1b`
- setup：先 create 201，再把其余库存 `frozen`，释放预占 `d3_14_inventory_exhaustion`；支付前 available=0
- 用户现网支付宝已付；本地 webhook 当时未到（订单 TTL 已过）。补偿：官方查单 paid → 商户重签 → `POST /api/shop/guest/webhooks/zpay` HTTP 200 `{accepted:true, confirmed:true}`
- **验收点 afterWebhook**：订单 `confirmed` / `released` / `paid_unfulfillable` / `refund_pending` / `paid_inventory_not_reservable`；支付行 confirmed / paid_amount=0.01；预占仍 released，未重新预占；库存 frozen 41 / sold 1，sold 仍 D3-01 `052c5e12-7d10-496b-b610-2a74139dcc1f`；D3-01 仍 delivered；新事件 processed 且 signature/amount/currency/final_status verified
- worker 随后自动退款，把快照冲成 refunded。D3-14 不以 worker 后状态验收
- 证据：`/tmp/d3-14-confirm-evidence.json`、`/tmp/d3-14-verdict.json`、`/tmp/d3-14-live-snapshot.json`
- 禁止写入：卡密、口令、支付密钥、原始签名
- 结果：PASS。不是 mock。真扣并随后真退 ¥0.01

## D3-15 退款成功（2026-09-15）

- 同一笔 D3-14 新单，不退 D3-01
- 生产路径：`confirm_payment` 对 late-success 置 `refund_status=pending`，worker 扫描 `paid_unfulfillable` 后调用 ZPay 退款
- worker 200：scanned=1 / processed=1 / delivered=0 / refunded=1
- 终态：订单 `payment_status=refunded` / `fulfillment_status=refunded` / `refund_status=succeeded` / `fulfilled_at=null`；支付行 refunded / paid_amount=0.01
- 22:08 CST 官方查单：`status=refunded` / `status_raw=2` / money=0.01 / out_trade_no 匹配
- 库存仍 frozen 41 / sold 1；D3-01 仍 confirmed/consumed/delivered/refund_status=none
- 合同修正：本条完成标准是真实渠道退款成功。Admin `request_refund` 对已 succeeded 会 `guest_admin_not_eligible`，不必另开一笔
- 证据：`/tmp/d3-14-confirm-evidence.json`（worker 段）、`/tmp/d3-14-live-snapshot.json`（zpayQuery.status=refunded）
- 禁止写入：卡密、口令、支付密钥、原始签名
- 结果：PASS。不是 mock，也没有退 D3-01

## D3-09 错网络 PASS + INTL 成功支付未入账（2026-09-15）

- 解开条件已满足：SKU `price_points` `0.01 → 144`；现网 min `usd→usdtbsc` ≈ `19.052892`；游客商品仍 1 个、该商品 1 个 SKU
- 新单 `GS20260915150703326FB1F73A265FA` / 支付行 `667d6ff5-b0a2-4227-b079-2d0a78eaec6a` / NOWPayments `payment_id=5250755581`
- 错网络：`actually_paid_currency=usdttrc20` → HTTP 202 `{accepted:false}`；事件 `af1ad08a-818a-418b-bd53-4c319e03b02f` rejected / `observed_status=wrong_asset`
- 成功支付未入账：官方查单 `payment_status=expired` / `actually_paid=0` / `updated_at=2026-09-15T15:12:30.422Z`。本地仍 pending/created/held。quote 过期 webhook `b918da7c-6162-490a-bc92-06cd31fd4534` rejected
- 库存：available 40 / reserve 1 / sold 1；sold 仍 D3-01 `052c5e12-7d10-496b-b610-2a74139dcc1f`
- 用户在支付宝下载页说「已经支付成功」：现网没有新支付宝单；最新已付仍是已退 D3-14
- 证据：`/tmp/d3-09-raise-price-evidence.json`、`/tmp/d3-09-wrong-network-raised-evidence.json`、`/tmp/d3-09-nowpayments-status2.json`
- 禁止写入：卡密、口令、支付密钥、pay_address、原始签名
- 结果：错网络 PASS。INTL 成功支付未完成。不要付已过期发票，释放预占后重建

## 用户自建 INTL USDT 成功路径（等待付款）

- 2026-09-15T23:12Z 只读复核：preview `:8000` 健康；游客商品仍 1 个；SKU `price_points=144`；库存 available 41 / sold 1；held 0
- 旧 INTL 发票 `GS20260915150703326FB1F73A265FA` 与 CN 站 USDT `GS20260915154204621A4A9522C7A10` 均已过期释放，不要付款
- 成功路径改为用户打开 `http://localhost:8000/shop.html?site=intl` 自建 USDT-BEP20 单并真付；Codex 不代建发票
- D3-16 用该成功单；不要退 D3-01

## 补现有 SKU `price_points_intl=144`（2026-09-16 07:27 CST）

- 用户确认后走 admin GET 全量 + `upsert_product`；只改 SKU `db8cc9bd-898a-49ff-adb4-cc07f94d7d8f`
- before：`price_points=144` / `price_points_intl=null`；INTL catalog 19 件，无「测试 2」
- after：`price_points=144` / `price_points_intl=144`；INTL catalog 20 件，出现「测试 2」；guest preview intl 200 / 144 CNY / 通道含 nowpayments
- 游客商品仍 1 个；库存 available=41 / sold=1；held=0；D3-01 仍 delivered / sold
- 商品级 `price_points_intl` 仍为 null。目录可见性靠 SKU 站点价，不需要第二个游客商品
- 证据：`/tmp/d3-fill-intl-price-144-evidence.json`
- 禁止写入：卡密、口令、支付密钥、pay_address、原始签名
- 结果：INTL 目录可见性缺口已修。INTL 成功支付仍等人在 `?site=intl` 自建 USDT-BEP20 并真付

## 补商品级 `price_points_intl=144`（2026-09-16 07:35 CST）

- 现象：SKU 级已是 144，catalog API 有「测试 2」，但 intl shop 页面仍不展示
- 根因：前端 `SiteConfig.filterProductsForCurrentSite` 只看商品级 `price_points_intl`，当时仍为 null
- after：商品级 `price_points=1` / `price_points_intl=144`；SKU 两档仍 144；catalog 商品级 intl=144；`frontendWouldShow=true`
- 游客商品仍 1 个；库存 available=41 / sold=1
- 证据：`/tmp/d3-fill-product-intl-price-144-evidence.json`
- 禁止写入：卡密、口令、支付密钥、pay_address、原始签名
- 结果：页面过滤缺口已修。需要用户硬刷新 `?site=intl` 后再买
