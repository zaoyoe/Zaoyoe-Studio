# xianyu-auto-reply-fix 接入早有耳库存

这个目录用于把 [GuDong2003/xianyu-auto-reply-fix](https://github.com/GuDong2003/xianyu-auto-reply-fix) 接到早有耳网站库存和发货系统。

该闲鱼项目已经具备 FastAPI、SQLite、多账号、自动回复、自动发货和 Web 管理后台。我们的做法是不接管它的闲鱼登录和聊天能力，只给它加两个很薄的接口：

- `GET /zaoyoe/orders/paid`：给 `bridge-worker` 读取已付款闲鱼订单。
- `POST /zaoyoe/chat/send`：给 `bridge-worker` 把网站返回的发货内容发回闲鱼聊天框。

## 安装方式

推荐用安装器自动复制并挂载：

```bash
npm run marketplace:xianyu:install-bot-bridge -- --target /path/to/xianyu-auto-reply-fix
```

安装器会做三件事：

- 复制 `zaoyoe_bridge.py` 到 `xianyu-auto-reply-fix` 根目录。
- 复制 `zaoyoe_sender_example.py` 到 `xianyu-auto-reply-fix` 根目录。
- 备份并修改 `reply_server.py`，在末尾挂载 `zaoyoe_bridge` router。

也可以手工执行：

```bash
cp /Volumes/chao/AI/xianyu_profit_calculator/integrations/xianyu-auto-reply-fix/zaoyoe_bridge.py ./zaoyoe_bridge.py
cp /Volumes/chao/AI/xianyu_profit_calculator/integrations/xianyu-auto-reply-fix/zaoyoe_sender_example.py ./zaoyoe_sender_example.py
```

然后打开它的 `reply_server.py`，找到创建 FastAPI `app` 的位置，在后面加：

```python
from zaoyoe_bridge import router as zaoyoe_bridge_router
app.include_router(zaoyoe_bridge_router)
```

重启 `xianyu-auto-reply-fix` 后，先测试健康检查：

```bash
curl http://127.0.0.1:8090/zaoyoe/health
```

也可以用本项目的验收脚本一次检查健康检查和已付款订单接口：

```bash
npm run marketplace:xianyu:smoke-bot-bridge -- --base-url http://127.0.0.1:8090
```

如果已经设置了 `ZAOYOE_BRIDGE_OUTBOX_FILE` 做 dry-run，可以连聊天发送接口一起测：

```bash
npm run marketplace:xianyu:smoke-bot-bridge -- --base-url http://127.0.0.1:8090 --send-test-message
```

## 抓已付款订单

`zaoyoe_bridge.py` 会读取 `DB_PATH` 指向的 SQLite 数据库，默认是：

```bash
DB_PATH=data/xianyu_data.db
```

测试：

```bash
curl "http://127.0.0.1:8090/zaoyoe/orders/paid?limit=20"
```

返回给我们 `bridge-worker` 的格式大致是：

```json
{
  "success": true,
  "orders": [
    {
      "orderId": "闲鱼订单号",
      "status": "买家已付款",
      "buyerId": "买家 ID",
      "buyerNick": "买家昵称",
      "item": {
        "itemId": "1051635270711",
        "title": "闲鱼商品标题",
        "skuText": ""
      },
      "quantity": 1
    }
  ]
}
```

## 发送聊天消息

`POST /zaoyoe/chat/send` 已经有接口壳，但真正“发到闲鱼聊天框”的动作要绑定到 `xianyu-auto-reply-fix` 当前版本里的发送消息方法。

推荐用环境变量指定一个自定义发送函数：

```bash
ZAOYOE_BRIDGE_CHAT_SENDER=zaoyoe_sender_example:send_message
```

然后把 `zaoyoe_sender_example.py` 里的 TODO 改成调用真实发送函数。

在还没绑定真实发送函数前，可以先用 outbox 文件做 dry-run：

```bash
ZAOYOE_BRIDGE_OUTBOX_FILE=data/zaoyoe_bridge_outbox.jsonl
```

这样 `/zaoyoe/chat/send` 不会真的发闲鱼消息，只会把待发送内容写进文件，方便验链路。

## 启动我们的网站桥接 worker

如果 `xianyu-auto-reply-fix` 是本地运行，默认 API 端口通常是 `8090`：

```bash
npm run marketplace:xianyu:bridge -- \
  --base-url https://www.zaoyoe.com \
  --account main \
  --token "Admin Studio 里的发货接口 Token" \
  --bot-orders-url http://127.0.0.1:8090/zaoyoe/orders/paid \
  --bot-send-message-url http://127.0.0.1:8090/zaoyoe/chat/send \
  --processed-file .cache/xianyu-main-processed-orders.json
```

如果 Docker 运行端口映射成 `9000` 或 `8000`，把上面的 `8090` 换成实际端口。

## 最终链路

```text
xianyu-auto-reply-fix 抓到已付款订单
-> /zaoyoe/orders/paid
-> marketplace:xianyu:bridge
-> https://www.zaoyoe.com/api/marketplace/xianyu/orders
-> 网站扣库存并返回 data.content
-> /zaoyoe/chat/send
-> xianyu-auto-reply-fix 发到闲鱼聊天框
```

## 安全建议

如果这两个接口不是只监听本机，设置一个 Token：

```bash
ZAOYOE_BRIDGE_TOKEN=一段随机长密码
XIANYU_BOT_TOKEN=同一段随机长密码
```

`bridge-worker` 会用 `XIANYU_BOT_TOKEN` 作为 Bearer Token 调用闲鱼项目。