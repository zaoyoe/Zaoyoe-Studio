# R2 Bucket 公共访问配置指南

## 问题

R2 bucket已启用"公共开发URL"，但访问时返回 `401 Unauthorized` 错误。

## 原因

Cloudflare R2需要**两步配置**才能允许公共访问：
1. ✅ 启用公共开发URL（已完成）
2. ❌ **设置Bucket Policy允许公共读取**（缺失）

---

## 解决方案

### 方案A: 通过Dashboard配置（推荐）

1. 打开 Cloudflare Dashboard → R2 → `zaoyoeimages` bucket
2. 点击 **Settings** 标签
3. 找到 **"Public Access"** 或 **"公共访问"** 部分
4. 如果看到 **"Connect a domain"**，点击连接域名
5. 或者找到 **"Allow Access"** 按钮并点击

### 方案B: 使用Wrangler CLI配置

```bash
# 为bucket设置公共访问策略
wrangler r2 bucket cors-policy set zaoyoeimages --cors-policy '[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]'
```

### 方案C: 设置Bucket为完全公开

**注意**: 这会让bucket中所有文件都可公开访问

```bash
wrangler r2 bucket create-public zaoyoeimages
```

---

## 快速测试

配置完成后，测试URL：

```bash
curl -I "https://pub-8c83901b01d7446b834ec829b623bf7b.r2.dev/avatars/0b07909e-e2d0-4350-bf14-4cfea4e9ac23.jpg"
```

**期望结果**:
```
HTTP/1.1 200 OK
Content-Type: image/jpeg
```

---

## 备选方案：使用Cloudflare Workers代理

如果无法启用公共访问，可以创建Worker代理R2：

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1); // Remove leading '/'
    
    const object = await env.MY_BUCKET.get(key);
    if (!object) return new Response('Not Found', { status: 404 });
    
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000'
      }
    });
  }
};
```

---

## 当前状态

- ✅ 公共开发URL已启用
- ❌ 文件无法访问（401 Unauthorized）
- ❌ 需要配置Bucket Policy或CORS

**请按照上述方案配置，然后重新测试。**
