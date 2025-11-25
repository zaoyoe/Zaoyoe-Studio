# Porkbun 域名注册 + Resend 邮件配置完整指南

## 📋 目录

1. [Porkbun 注册域名](#porkbun-注册域名)
2. [Resend 添加域名](#resend-添加域名)
3. [配置 DNS 记录](#配置-dns-记录)
4. [验证域名](#验证域名)
5. [测试邮件发送](#测试邮件发送)

---

## 🐷 Porkbun 注册域名

### 步骤 1：访问 Porkbun

打开浏览器访问：**https://porkbun.com**

### 步骤 2：搜索域名

1. 在首页搜索框输入您想要的域名，例如：`zaoyoe`
2. 点击 "Search" 搜索

### 步骤 3：选择域名

- 查看 `.com` 可用性
- 价格显示为 **$9.13/year**
- 点击域名旁边的 **"Add to Cart"**

> 💡 **其他选择**：
> - `.xyz` - 约 $2.29/年（更便宜）
> - `.net` - 约 $11.13/年
> - `.org` - 约 $10.53/年

### 步骤 4：查看购物车

1. 点击右上角购物车图标
2. 检查包含的免费服务：
   - ✅ **WHOIS Privacy** - 免费（隐藏个人信息）
   - ✅ **SSL Certificate** - 免费
   - ✅ **Email Forwarding** - 免费

### 步骤 5：创建账号

1. 点击 "Checkout"
2. 填写注册信息：
   - Email（接收重要通知）
   - Password（设置密码）
3. 点击 "Create Account"

### 步骤 6：填写域名持有人信息

**必填信息**：
- First Name（名）
- Last Name（姓）
- Address（地址）
- City（城市）
- State/Province（省份）
- Postal Code（邮编）
- Country（国家）
- Phone（电话）

> ⚠️ **重要**：这些信息会被 WHOIS Privacy 隐藏，不会公开显示

### 步骤 7：支付

**支持的支付方式**：
- 💳 信用卡（Visa, Mastercard, Amex）
- 💰 PayPal
- 🪙 加密货币（可选）

**价格**：约 $9.13（首年）

### 步骤 8：完成注册

1. 支付成功后，您会收到确认邮件
2. 域名立即激活
3. 登录 Porkbun 账户管理面板

---

## 📧 Resend 添加域名

### 步骤 1：登录 Resend

访问：**https://resend.com/login**

使用您之前注册的账号登录

### 步骤 2：添加域名

1. 进入 Dashboard
2. 左侧菜单点击 **"Domains"**
3. 点击 **"Add Domain"** 按钮
4. 输入您的域名（例如：`zaoyoe.com`）
5. 点击 **"Add"**

### 步骤 3：查看 DNS 记录

添加后，Resend 会显示需要配置的 DNS 记录：

#### 📝 **需要添加的记录**：

**1. SPF 记录（TXT）**
```
Type: TXT
Name: @
Value: v=spf1 include:amazonses.com ~all
```

**2. DKIM 记录（CNAME）** (3条)
```
Type: CNAME
Name: <resend提供的随机字符串>._domainkey
Value: <resend提供的值>.dkim.amazonses.com
```
*会有3条类似的记录*

**3. DMARC 记录（TXT）**
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none
```

**4. 跟踪域名（CNAME）**（可选）
```
Type: CNAME
Name: resend
Value: <resend提供的值>
```

> 💡 **复制这些记录**，我们将在下一步添加到 Porkbun

---

## 🌐 配置 DNS 记录

### 步骤 1：进入 Porkbun DNS 管理

1. 登录 Porkbun：https://porkbun.com/account/domains
2. 找到您的域名
3. 点击域名右侧的 **"Details"**
4. 选择 **"DNS Records"** 标签

### 步骤 2：添加 SPF 记录

1. 点击 **"Add"**
2. 填写：
   - **Type**: `TXT`
   - **Host**: `@`（或留空）
   - **Answer**: `v=spf1 include:amazonses.com ~all`
   - **TTL**: `600`（默认）
3. 点击 **"Add"**

### 步骤 3：添加 DKIM 记录（3条）

**对于每一条 DKIM 记录**：

1. 点击 **"Add"**
2. 填写：
   - **Type**: `CNAME`
   - **Host**: `<从Resend复制的Name>`（例如：`abc123._domainkey`）
   - **Answer**: `<从Resend复制的Value>`
   - **TTL**: `600`
3. 点击 **"Add"**
4. 重复添加另外 2 条

### 步骤 4：添加 DMARC 记录

1. 点击 **"Add"**
2. 填写：
   - **Type**: `TXT`
   - **Host**: `_dmarc`
   - **Answer**: `v=DMARC1; p=none`
   - **TTL**: `600`
3. 点击 **"Add"**

### 步骤 5：（可选）添加跟踪域名

1. 点击 **"Add"**
2. 填写：
   - **Type**: `CNAME`
   - **Host**: `resend`
   - **Answer**: `<从Resend复制>`
   - **TTL**: `600`
3. 点击 **"Add"**

---

## ✅ 验证域名

### 步骤 1：等待 DNS 传播

- **通常需要**：5-30 分钟
- **最长可能**：24-48 小时
- 国际 DNS 更新较快

### 步骤 2：在 Resend 验证

1. 回到 Resend Dashboard
2. 进入 **Domains**
3. 找到您的域名
4. 点击 **"Verify"** 或 刷新页面

### 步骤 3：检查验证状态

**验证成功标志**：
- ✅ **SPF**: Verified
- ✅ **DKIM**: Verified (3/3)
- ✅ **DMARC**: Verified
- 🟢 **Status**: Active

如果显示 **Pending**，请等待几分钟后刷新

### 步骤 4：检查 DNS 传播（可选）

使用在线工具检查：
- 访问：https://dnschecker.org
- 输入您的域名
- 选择记录类型（TXT 或 CNAME）
- 查看全球传播状态

---

## 🧪 测试邮件发送

### 步骤 1：更新 Cloud Function

域名验证成功后，需要在 Cloud Function 中更新发件人地址：

打开 `/Volumes/chao/AI/xianyu_profit_calculator/functions/index.js`

找到第 44 行：
```javascript
from: 'Zaoyoe <noreply@resend.dev>',
```

修改为：
```javascript
from: 'Zaoyoe <noreply@YOUR-DOMAIN.com>',
```

例如：
```javascript
from: 'Zaoyoe <noreply@zaoyoe.com>',
```

### 步骤 2：重新部署

```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
npx firebase deploy --only functions:sendPasswordResetEmail
```

### 步骤 3：测试密码找回功能

1. 打开您的网站
2. 点击 "忘记密码了吗？"
3. 输入**任意已注册的邮箱**（不再限制！）
4. 点击 "找回"

### 步骤 4：验证邮件送达

检查收件人邮箱：
- ✅ 邮件应该在 **收件箱**（不在垃圾箱）
- ✅ 发件人显示：`Zaoyoe <noreply@你的域名.com>`
- ✅ 邮件内容精美，带有重置密码按钮

---

## 🎉 完成！

现在您可以：
- ✅ 向任何邮箱发送密码重置邮件
- ✅ 邮件进入收件箱而非垃圾箱
- ✅ 专业的邮件发送体验
- ✅ 每月 3,000 封免费额度

---

## 🆘 常见问题

### Q: DNS 记录添加后多久生效？
**A**: 通常 5-30 分钟，最长 48 小时

### Q: 验证一直显示 Pending 怎么办？
**A**: 
1. 检查 DNS 记录是否正确
2. 等待更长时间
3. 使用 dnschecker.org 检查传播状态

### Q: 邮件还是进垃圾箱怎么办？
**A**:
1. 确认所有 DNS 记录都已验证
2. 发送几封测试邮件后，Gmail 会学习
3. 让收件人标记为"非垃圾邮件"

### Q: 域名费用是一次性的吗？
**A**: 不是，需要每年续费（$9.13/年）

### Q: 可以更换域名吗？
**A**: 可以，在 Resend 添加新域名并更新 Cloud Function

---

## 📞 需要帮助？

- **Porkbun 客服**: support@porkbun.com
- **Resend 客服**: support@resend.com
- **Firebase 文档**: https://firebase.google.com/docs/functions

---

**祝您配置顺利！** 🚀
