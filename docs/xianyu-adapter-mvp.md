# 闲鱼适配器 MVP

这一步先把“闲鱼订单 -> 网站共享库存发货入口”打通。适配器本身不保存库存，也不单独发货；它只负责把闲鱼订单整理成网站已经支持的商城接单请求，让闲鱼和网站共用同一套商品库存与发货逻辑。

## 当前能力

- 支持一个闲鱼账号配置一个发货 Token，后续可以按账号多开适配器。
- 只处理“已付款 / 待发货 / 交易成功”等已付款订单，未付款或退款订单会跳过。
- 通过 Admin Studio 里的商品映射把闲鱼商品 ID 对应到网站 `product_id`。
- 默认 dry-run，只打印将要提交的订单，不会扣库存。
- 正式提交时使用 Admin Studio 里生成的“发货接口 Token”调用网站公开接入口。
- 真实闲鱼抓单项目推荐调用 `POST /api/marketplace/xianyu/orders`，只提交原始闲鱼订单；网站会自动做商品映射、扣库存和发货。

## 文件

- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/core.js`：订单整理、商品映射、提交网站接口。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/admin-runtime.js`：读取 Admin Studio 保存的闲鱼渠道、账号、Token 和商品映射。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/adapter.js`：本地命令行入口。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/bridge-worker.js`：真实闲鱼抓单/聊天自动化项目的通用桥接 worker。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/bridge-worker.example.js`：桥接 worker 的兼容示例入口。
- `/Volumes/chao/AI/xianyu_profit_calculator/integrations/xianyu-auto-reply-fix/`：推荐接入 `xianyu-auto-reply-fix` 的 FastAPI 路由和说明。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/config.example.json`：示例配置。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/mock-orders.example.json`：示例闲鱼订单。

## 真实闲鱼抓单项目推荐接入口

真实接入时，不建议让闲鱼抓单项目自己保存网站商品 ID 或自己扣库存。它只需要把抓到的原始闲鱼订单发给网站：

```http
POST https://www.zaoyoe.com/api/marketplace/xianyu/orders?account=main
Authorization: Bearer 从 Admin Studio 复制的发货接口 Token
Content-Type: application/json
```

请求体可以把原始订单放在 `order` 里：

```json
{
  "order": {
    "orderId": "XY-ORDER-1001",
    "status": "买家已付款",
    "buyerId": "buyer-1",
    "buyerNick": "闲鱼买家",
    "item": {
      "itemId": "1051635270711",
      "title": "Hostinger 全场再打8折",
      "skuText": ""
    },
    "quantity": 1,
    "payAmount": "1.00",
    "totalAmount": "1.00",
    "createdAt": "2026-05-21T15:05:00.000Z"
  }
}
```

网站会在服务端完成这些事：

- 校验这个闲鱼账号的 Token。
- 读取 Admin Studio 里的“闲鱼商品 ID -> 网站商品”映射。
- 只处理已付款/待发货订单，未付款订单返回 skipped。
- 调用共享库存发货链路。
- 把发货结果和可发送给买家的内容放在响应里。

成功响应大致是：

```json
{
  "success": true,
  "duplicate": false,
  "message": "Xianyu marketplace order created",
  "normalized_order": {
    "external_order_id": "XY-ORDER-1001",
    "pay_status": "买家已付款",
    "xianyu_item_id": "1051635270711"
  },
  "data": {
    "order_id": "网站订单 ID",
    "delivery_status": "delivered",
    "content": "这里是要发给闲鱼买家的发货内容"
  }
}
```

所以真实闲鱼自动化项目的职责很清晰：

1. 登录闲鱼账号并抓取已付款订单。
2. 把原始订单提交到 `POST /api/marketplace/xianyu/orders?account=账号key`。
3. 如果响应里 `success=true` 且不是 `skipped`，读取 `data.content`。
4. 调用闲鱼聊天自动化，把 `data.content` 发给该订单买家。
5. 本地记录已经处理过的 `external_order_id`，避免重复给买家发消息。

## 通用桥接 worker

如果选定的闲鱼开源项目能提供两个 HTTP 能力，就可以直接接入：

- `GET 已付款订单列表`：返回待处理的闲鱼订单数组。
- `POST 发送聊天消息`：收到订单号、买家信息、发货内容后，把内容发到闲鱼聊天框。

桥接 worker 负责中间这一段：

```text
闲鱼自动化项目 -> bridge-worker -> 网站 /api/marketplace/xianyu/orders -> bridge-worker -> 闲鱼聊天框
```

本地单次运行：

```bash
npm run marketplace:xianyu:bridge -- \
  --base-url https://www.zaoyoe.com \
  --account main \
  --token "从 Admin Studio 复制的发货接口 Token" \
  --bot-orders-url http://127.0.0.1:19090/orders/paid \
  --bot-send-message-url http://127.0.0.1:19090/chat/send \
  --processed-file .cache/xianyu-main-processed-orders.json
```

持续轮询运行：

```bash
npm run marketplace:xianyu:bridge -- \
  --env-file server/.env.xianyu-bridge \
  --loop \
  --interval-ms 30000
```

如果希望更快发现闲鱼已付款订单，可以把 `--interval-ms` 调到 `5000` 到 `10000`。例如：

```bash
npm run marketplace:xianyu:bridge -- \
  --env-file server/.env.xianyu-bridge \
  --loop \
  --interval-ms 5000
```

环境变量写法：

```bash
XIANYU_BRIDGE_BASE_URL=https://www.zaoyoe.com
XIANYU_BRIDGE_ACCOUNT=main
XIANYU_BRIDGE_INGEST_TOKEN=从 Admin Studio 复制的发货接口 Token
XIANYU_BOT_ORDERS_URL=http://127.0.0.1:19090/orders/paid
XIANYU_BOT_SEND_MESSAGE_URL=http://127.0.0.1:19090/chat/send
XIANYU_BOT_TOKEN=闲鱼自动化项目自己的访问 Token
XIANYU_BRIDGE_PROCESSED_FILE=.cache/xianyu-main-processed-orders.json
```

排查“付款后多久才发货”时，可以临时开启诊断日志：

```bash
XIANYU_BRIDGE_DIAGNOSTICS=1
```

开启后，bridge worker 会在每笔订单完成、跳过或失败时输出分段耗时：

- `order_paid_age_ms`：闲鱼付款时间到 bridge worker 开始处理的时间。如果这里很大，通常是闲鱼订单同步或 bridge 轮询慢。
- `website_ms`：bridge worker 调用网站创建发货订单的耗时。如果这里很大，通常是网站接口、库存匹配或数据库慢。
- `chat_send_ms`：把发货内容发回闲鱼聊天框的耗时。如果这里很大，通常是闲鱼聊天自动化端连接、WebSocket 或重试慢。
- `total_ms`：这笔订单在 bridge worker 内部的总处理时间。

多账号时，不需要改代码。给每个闲鱼账号准备一份不同的 `XIANYU_BRIDGE_ACCOUNT`、`XIANYU_BRIDGE_INGEST_TOKEN`、`XIANYU_BRIDGE_PROCESSED_FILE`，分别启动一个 worker 即可。

如果采用推荐的 `xianyu-auto-reply-fix`，可以直接运行安装器把桥接路由挂进去：

```bash
npm run marketplace:xianyu:install-bot-bridge -- --target /path/to/xianyu-auto-reply-fix
```

详细步骤见 `/Volumes/chao/AI/xianyu_profit_calculator/integrations/xianyu-auto-reply-fix/README.md`。

安装并重启闲鱼项目后，可以先验收它的桥接接口：

```bash
npm run marketplace:xianyu:smoke-bot-bridge -- --base-url http://127.0.0.1:8090
```

## 运行模拟订单

执行：

```bash
npm run marketplace:xianyu:mock
```

这个命令是 dry-run，不需要启动网站，也不会扣库存，只会输出整理后的订单 payload。看到 `dry_run_count` 大于 0，就说明订单格式、付款状态识别、商品映射都能正常工作。

## 使用 Admin Studio 配置运行

在后台完成这些配置后：

- 启用“闲鱼自动发货”
- 添加或确认闲鱼账号
- 生成并保存该账号的“发货接口 Token”
- 在“闲鱼商品映射”里添加“闲鱼商品 ID -> 网站商品 ID”

就可以让适配器读取后台配置：

```bash
npm run marketplace:xianyu:admin -- --env-file server/.env.production --orders adapters/xianyu/mock-orders.example.json --base-url https://www.zaoyoe.com
```

这仍然是 dry-run，不会扣库存。它会读取 Supabase 里的 `marketplace_channels` 配置和商品映射。

## 正式提交到网站接入口

如果使用本地示例配置，先把 Admin Studio 里闲鱼账号的“发货接口 Token”放到环境变量：

```bash
export XIANYU_MARKETPLACE_INGEST_TOKEN="从 Admin Studio 复制的 Token"
```

再执行：

```bash
npm run marketplace:xianyu:mock -- --submit
```

如果使用 Admin Studio 后台配置，直接让适配器从后台密钥仓读取 Token：

```bash
npm run marketplace:xianyu:admin -- --env-file server/.env.production --orders adapters/xianyu/mock-orders.example.json --base-url https://www.zaoyoe.com --submit
```

提交成功后，网站会通过共享库存 RPC 创建商城订单并触发原有发货链路。重复的闲鱼订单号会由后端按 `external_order_id` 做幂等处理。

## 商品映射

当前示例配置是给开发联调用的底层格式，不需要你在 Admin Studio 里手写 JSON。日常使用时，在 Admin Studio 的“闲鱼商品映射”里填这两个值即可。最稳的映射方式是用闲鱼商品 ID 精确匹配网站商品 ID：

```json
{
  "label": "示例数字商品",
  "xianyu_item_id": "xianyu-demo-item-001",
  "product_id": "11111111-1111-4111-8111-111111111111"
}
```

Admin Studio 里已经是“搜索并选择网站商品”的操作方式，日常不需要手动复制网站商品 ID；保存后系统会把选择结果写入商品映射。

## 接真实闲鱼账号时的边界

真实闲鱼自动化通常依赖非官方浏览器会话或第三方开源项目，所以这一版先不把账号登录、Cookie、抓单逻辑写死进网站。真实接入时推荐让抓单项目直接调用 `POST /api/marketplace/xianyu/orders`，网站会统一做订单标准化、商品映射、库存扣减和发货。

推荐下一步继续做：

1. 接入一个独立的闲鱼抓单进程，抓到已付款订单后调用 `POST /api/marketplace/xianyu/orders`。
2. 在 Admin Studio 里增加“运行日志”，显示每个闲鱼账号最近抓单、发货、失败原因。
3. 把网站返回的 `data.content` 交给闲鱼聊天自动化项目发送给买家。
