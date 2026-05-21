# 闲鱼适配器 MVP

这一步先把“闲鱼订单 -> 网站共享库存发货入口”打通。适配器本身不保存库存，也不单独发货；它只负责把闲鱼订单整理成网站已经支持的 `POST /api/marketplace/orders` 请求，让闲鱼和网站共用同一套商品库存与发货逻辑。

## 当前能力

- 支持一个闲鱼账号配置一个发货 Token，后续可以按账号多开适配器。
- 只处理“已付款 / 待发货 / 交易成功”等已付款订单，未付款或退款订单会跳过。
- 通过 Admin Studio 里的商品映射把闲鱼商品 ID 对应到网站 `product_id`。
- 默认 dry-run，只打印将要提交的订单，不会扣库存。
- 正式提交时使用 Admin Studio 里生成的“发货接口 Token”调用网站公开接入口。

## 文件

- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/core.js`：订单整理、商品映射、提交网站接口。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/admin-runtime.js`：读取 Admin Studio 保存的闲鱼渠道、账号、Token 和商品映射。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/adapter.js`：本地命令行入口。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/config.example.json`：示例配置。
- `/Volumes/chao/AI/xianyu_profit_calculator/adapters/xianyu/mock-orders.example.json`：示例闲鱼订单。

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

后续可以继续升级成“直接搜索并选择网站商品”，这样连网站商品 ID 也不用手动复制。

## 接真实闲鱼账号时的边界

真实闲鱼自动化通常依赖非官方浏览器会话或第三方开源项目，所以这一版先不把账号登录、Cookie、抓单逻辑写死进网站。真实接入时只需要让抓单项目把原始订单传给 `normalizeXianyuOrder`，再调用 `buildMarketplaceOrderPayload` 和 `submitMarketplaceOrder`。

推荐下一步继续做：

1. 接入一个独立的闲鱼抓单进程，抓到已付款订单后调用本适配器。
2. 在 Admin Studio 里增加“运行日志”，显示每个闲鱼账号最近抓单、发货、失败原因。
3. 把“网站商品 ID”输入框升级成商品搜索选择器。
