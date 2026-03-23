# R2 Edge Function 部署指南

## 🎯 目标

部署Supabase Edge Function，使Admin Studio可以直接上传图片到Cloudflare R2 CDN。

---

## 📋 前置条件

1. ✅ Supabase CLI 已安装
2. ✅ 已有Cloudflare R2账号和bucket
3. ✅ R2 API凭证已准备好

---

## 🚀 部署步骤

### Step 1: 安装 Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# 或使用 npm
npm install -g supabase
```

### Step 2: 登录 Supabase

```bash
supabase login
```

浏览器会打开，完成登录。

### Step 3: Link 到您的项目

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator

# Link到项目
supabase link --project-ref <your-project-ref>
```

### Step 4: 设置环境变量（Secrets）

```bash
# 设置 R2 凭证
supabase secrets set R2_ENDPOINT=https://<your-account-id>.r2.cloudflarestorage.com
supabase secrets set R2_ACCESS_KEY=<您的R2 Access Key ID>
supabase secrets set R2_SECRET_KEY=<您的R2 Secret Access Key>
```

> **安全提示**：这些凭证仅存储在Supabase服务端，前端无法访问。

### Step 5: 部署 Edge Function

```bash
supabase functions deploy upload-to-r2
```

预期输出：
```
Deploying Function upload-to-r2...
✓ Function upload-to-r2 deployed successfully
URL: https://<your-project-ref>.supabase.co/functions/v1/upload-to-r2
```

---

## ✅ 验证部署

### 方法 1: 测试 Edge Function

```bash
# 创建测试文件
cat > test-upload.json << EOF
{
  "images": [
    {
      "base64": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "filename": "test_$(date +%s).webp"
    }
  ]
}
EOF

# 调用函数（需要有效的access token）
curl -X POST \
  https://<your-project-ref>.supabase.co/functions/v1/upload-to-r2 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d @test-upload.json
```

### 方法 2: 通过 Admin Studio 测试

1. 访问 `http://localhost:8000/admin-studio.html`
2. 上传一张图片
3. 点击 "Analyze"
4. 点击 "Save to Gallery"
5. 检查浏览器控制台：
   - 应该看到: `📤 Uploading N images to R2 CDN...`
   - 然后看到: `✅ Successfully uploaded N images to R2 CDN`
6. 检查数据库中的`images`字段，应该包含R2 URL

---

## 🔍 故障排查

### 问题 1: "Admin access required"

**原因**: 当前用户不是管理员

**解决**:
```sql
-- 在 Supabase SQL Editor 中运行
SELECT is_admin('<您的用户ID>');

-- 如果返回 false，添加管理员权限
-- （根据您的admin表结构调整）
```

### 问题 2: "R2 configuration error"

**原因**: 环境变量未正确设置

**解决**:
```bash
# 检查secrets
supabase secrets list

# 重新设置
supabase secrets set R2_ENDPOINT=...
supabase secrets set R2_ACCESS_KEY=...
supabase secrets set R2_SECRET_KEY=...

# 重新部署
supabase functions deploy upload-to-r2
```

### 问题 3: 上传失败，降级到Supabase Storage

**原因**: Edge Function调用失败

**调试步骤**:
1. 查看Edge Function日志:
   ```bash
   supabase functions logs upload-to-r2
   ```

2. 检查浏览器控制台错误

3. 验证R2凭证和bucket名称

---

## 📊 监控

### 查看日志

```bash
# 实时日志
supabase functions logs upload-to-r2 --follow

# 最近100条日志
supabase functions logs upload-to-r2 --limit 100
```

### Supabase Dashboard

访问: https://supabase.com/dashboard/project/<your-project-ref>/functions

查看:
- 调用次数
- 错误率
- 执行时间

---

## 🔄 更新 Edge Function

如果需要修改Edge Function代码：

```bash
# 1. 编辑文件
# supabase/functions/upload-to-r2/index.ts

# 2. 重新部署
supabase functions deploy upload-to-r2
```

---

## 🎯 下一步

部署成功后：

1. ✅ 在Admin Studio测试上传新提示词
2. ✅ 验证图片URL是R2 CDN地址
3. ✅ 检查画廊页面图片加载正常
4. ✅ 监控Edge Function性能

---

## 📝 注意事项

- **Edge Function限制**: 
  - 最大请求大小: 10MB
  - 执行超时: 50秒
  - 建议每次上传不超过5张图片

- **R2免费额度**:
  - 存储: 10GB
  - Class A操作: 100万次/月
  - Class B操作: 1000万次/月

- **降级方案**:
  - R2失败时自动降级到Supabase Storage
  - 可通过迁移脚本后续迁移到R2
