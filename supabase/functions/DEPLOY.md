# Supabase Edge Function 部署指南

## 文件位置
```
supabase/functions/verify/index.ts
```

## 部署步骤

### 1. 安装 Supabase CLI (如果没有)
```bash
npm install -g supabase
```

### 2. 登录 Supabase
```bash
supabase login
```

### 3. 链接项目
```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
supabase link --project-ref <your-project-ref>
```

### 4. 部署 Edge Function
```bash
supabase functions deploy verify
```

---

## 配置 API Key

部署完成后，在 **Admin Studio → 内容设置 → 验证服务** 中：

1. 设置 **每次验证价格**: 3 积分
2. 输入 **Batch API Key**: 使用你自己的真实密钥，通过受控后台配置注入，不要在文档、脚本或仓库文件里明文保存
3. 启用 **验证服务**

---

## 测试

1. 访问 http://localhost:8000/verify.html
2. 登录用户账户
3. 输入测试 Verification ID
4. 点击「开始验证」

---

## 注意事项

- Edge Function 使用 Deno 运行时，本地 IDE 可能显示 lint 错误，这是正常的
- API Key 存储在 system_config 表中，通过 Edge Function 安全访问
- 积分扣除使用 `fn_deduct_points` RPC 函数，先扣赠送积分再扣付费积分
