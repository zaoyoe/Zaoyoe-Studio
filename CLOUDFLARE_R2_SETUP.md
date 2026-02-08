# Cloudflare R2 配置指南

本指南将帮助您配置Cloudflare R2存储桶，用于托管优化后的图片。

## 📋 第1步：创建R2存储桶

### 1.1 登录Cloudflare Dashboard
1. 访问：https://dash.cloudflare.com
2. 登录您的账户

### 1.2 创建R2 Bucket
1. 在左侧菜单点击 **R2**
2. 点击 **Create bucket** 按钮
3. 填写配置：
   - **Bucket name**: `zaoyoe-images`
   - **Location**: 自动（Cloudflare会选择最优位置）
4. 点击 **Create bucket**

✅ Bucket创建成功！

---

## 🔑 第2步：创建API Token

### 2.1 生成R2 API Token
1. 在R2页面，点击 **Manage R2 API Tokens**
2. 点击 **Create API Token**
3. 填写配置：
   - **Token name**: `zaoyoe-upload`
   - **Permissions**: 
     - ✅ Object Read & Write
   - **TTL**: 永久（或您偏好的时长）
   - **Bucket**: 选择 `zaoyoe-images`
4. 点击 **Create API Token**

### 2.2 保存Token信息
创建后会显示以下信息，**请立即保存**（关闭后无法再查看）：

```
Access Key ID: [YOUR_ACCESS_KEY_ID]
Secret Access Key: [YOUR_SECRET_ACCESS_KEY]
```

---

## 🌐 第3步：配置公开访问

### 3.1 连接自定义域名（推荐）

1. 在R2 Bucket详情页，点击 **Settings** 选项卡
2. 找到 **Public access** 部分
3. 点击 **Connect Domain**
4. 选择 **Custom Domains**
5. 输入子域名：`cdn.zaoyoe.com`
6. 点击 **Connect**

Cloudflare会自动：
- ✅ 添加DNS记录
- ✅ 配置SSL证书
- ✅ 启用CDN缓存

### 3.2 或使用R2.dev域名（备选）

如果不想用自定义域名：
1. 在 **Public access** 部分
2. 点击 **Allow Access**
3. 系统会生成一个公开URL：
   ```
   https://pub-[RANDOM_ID].r2.dev
   ```

---

## 💻 第4步：配置环境变量

在本地终端设置环境变量（用于运行上传脚本）：

```bash
# 替换为您的实际值
export R2_ACCOUNT_ID="your-account-id"
export R2_ACCESS_KEY_ID="your-access-key-id"
export R2_SECRET_ACCESS_KEY="your-secret-access-key"
export R2_BUCKET_NAME="zaoyoe-images"
```

### 如何获取Account ID
1. 在Cloudflare Dashboard右侧
2. 找到 **Account ID**
3. 复制该ID

---

## 🚀 第5步：运行上传脚本

### 5.1 安装依赖
```bash
npm install
```

### 5.2 上传图片
```bash
npm run upload-to-r2
```

脚本会：
1. 连接到R2 Bucket
2. 上传 `/assets/prompts-optimized/` 中的所有图片
3. 设置正确的Content-Type
4. 配置1年缓存策略

---

## ✅ 第6步：验证上传

### 6.1 检查Bucket
1. 在Cloudflare Dashboard打开您的Bucket
2. 应该能看到所有上传的图片

### 6.2 测试图片URL

**如果使用自定义域名**：
```
https://cdn.zaoyoe.com/3D_chibi_style______1_1.webp
```

**如果使用R2.dev域名**：
```
https://pub-[YOUR-ID].r2.dev/3D_chibi_style______1_1.webp
```

在浏览器中打开URL，应该能看到图片！

---

## 🔒 第7步：配置CORS（如果需要）

如果从zaoyoe.com访问cdn.zaoyoe.com的图片时遇到CORS错误：

### 7.1 设置CORS规则
1. 在Bucket设置页面
2. 找到 **CORS Policy** 部分
3. 点击 **Edit**
4. 添加以下规则：

```json
[
  {
    "AllowedOrigins": [
      "https://www.zaoyoe.com",
      "https://zaoyoe.com",
      "http://localhost:8000"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## 📊 成本说明

**Cloudflare R2定价**：
- 存储：$0.015 / GB / 月
  - 您的23MB = **$0.0003/月** ≈ 免费
  
- 出站流量（Egress）：**$0**
  - ✅ 完全免费，无限制！
  
- 操作费用：
  - Class A（写入）：$4.50 / 百万次
  - Class B（读取）：$0.36 / 百万次
  - 您的使用量：可忽略不计

**总计：约$0/月** 🎉

---

## 🛠️ 故障排查

### 上传失败："Access Denied"
- 检查API Token权限是否包含 Object Read & Write
- 确认Bucket名称正确

### 图片无法访问：404
- 确认已启用Public Access
- 检查文件名是否正确（区分大小写）

### CORS错误
- 按照第7步配置CORS策略
- 确保域名拼写正确

---

## 📞 下一步

配置完成后，继续执行：
1. ✅ 运行上传脚本
2. ✅ 验证图片可访问
3. ✅ 更新代码中的图片URL
4. ✅ 部署到Vercel

需要帮助？参考官方文档：
- https://developers.cloudflare.com/r2/
