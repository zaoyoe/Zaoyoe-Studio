# 前端代码修改指南

## 📝 需要修改的文件

### 1. index.html

**需要删除的内容** (第 24-74 行)：
整个 Firebase SDK 的 `<script type="module">` 块

**替换为**：
```html
<!-- Laf SDK -->
<script src="./laf-init.js"></script>
<script src="./laf-auth-functions.js"></script>
<script src="./laf-guestbook-functions.js"></script>
```

---

### 2. script.js

**需要注释掉或删除的函数**：

1. **handleRegister** (约第 603-673 行)
2. **handleLogin** (约第 722+ 行) 
3. **handleGoogleLogin** (约第 676-720 行) - **可以完全删除**
4. **handlePasswordReset** (约第 726+ 行)
5. 所有 `onAuthStateChanged` 相关代码

这些函数已经在 `laf-auth-functions.js` 中重新实现了。

**如果不想删除原代码**，可以在每个函数前加注释：
```javascript
// ❌ Firebase 版本 - 已废弃
// async function handleRegister() { ... }
```

---

### 3. guestbook.js (如果有使用 Firestore)

类似的，需要将所有 Firebase Firestore 的查询替换为 Laf 云函数调用。

---

## ⚠️ 重要：修改 laf-init.js

打开 `laf-init.js`，找到第 8 行：

```javascript
const LAF_BASE_URL = 'https://YOUR-APP-NAME.laf.run';
```

**替换为您在 Laf 创建的实际应用地址！**

---

## 🧪 测试步骤

### 1. 启动本地服务器
```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
python3 -m http.server 8000
```

### 2. 打开浏览器
访问：http://localhost:8000

### 3. 打开开发者工具 (F12)
查看 Console 是否有错误

### 4. 测试功能
- 注册新用户
- 登录
- 发送留言
- 密码找回

---

## 📋 完整操作清单

- [ ] 注册 Laf 账号 (laf.run)
- [ ] 创建应用，获取域名
- [ ] 创建数据库集合 (users, messages)
- [ ] 创建 6 个云函数 (参考 LAF_CLOUD_FUNCTIONS.md)
- [ ] 安装依赖 (bcrypt, resend)
- [ ] 修改 laf-init.js 中的 LAF_BASE_URL
- [ ] 修改 index.html (删除 Firebase, 引入 Laf)
- [ ] 测试所有功能
- [ ] 推送到 GitHub
- [ ] Vercel 自动部署

---

## 💡 如果遇到问题

### CORS 错误
Laf 默认允许跨域，应该不会有问题。如果有，在 Laf 控制台 → 设置 → CORS 中添加您的域名。

### Token 无效
检查 localStorage 中是否有 `laf_token`，如果没有，重新登录。

### 云函数报错
查看 Laf 控制台 → 日志，会显示详细错误信息。

---

**祝您迁移顺利！** 🎉
