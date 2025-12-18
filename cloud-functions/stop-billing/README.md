# 预算超限自动停止计费 - 部署指南

## 🎯 功能说明

当你的 Google Cloud 账单达到预算上限时，这个 Cloud Function 会**自动禁用项目计费**，防止任何超支。

---

## 📋 部署步骤

### 第一步：创建 Pub/Sub 主题

```bash
gcloud pubsub topics create budget-alerts
```

### 第二步：部署 Cloud Function

```bash
cd cloud-functions/stop-billing

gcloud functions deploy stopBillingOnBudgetExceeded \
  --runtime nodejs18 \
  --trigger-topic budget-alerts \
  --region asia-east2 \
  --project YOUR_PROJECT_ID
```

### 第三步：授予权限

Cloud Function 需要「Billing Account Administrator」权限才能禁用计费：

1. 访问 [IAM 页面](https://console.cloud.google.com/iam-admin/iam)
2. 找到 Cloud Function 使用的服务账号（通常是 `YOUR_PROJECT_ID@appspot.gserviceaccount.com`）
3. 添加角色：**Billing Account Administrator**

### 第四步：连接预算到 Pub/Sub

1. 访问 [Billing > Budgets](https://console.cloud.google.com/billing/budgets)
2. 编辑你的预算（或创建新预算）
3. 在「操作」部分：
   - 勾选 **「连接到 Pub/Sub 主题」**
   - 选择刚才创建的 `budget-alerts` 主题
4. 保存

---

## ✅ 测试

设置一个很低的预算（如 $0.01），等待几分钟后检查：
- Cloud Function 日志中是否有触发记录
- 项目计费是否已被禁用

---

## ⚠️ 注意事项

1. **计费禁用后**：所有付费服务会立即停止（包括 Gemini API）
2. **恢复服务**：需要手动在 Billing 页面重新关联账单
3. **延迟**：预算通知可能有 1-2 小时延迟

---

## 🔧 文件说明

- `index.js` - Cloud Function 主代码
- `package.json` - 依赖配置
