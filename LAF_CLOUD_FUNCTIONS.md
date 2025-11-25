# Laf 云函数代码

将以下代码分别复制到 Laf 控制台的云函数编辑器中。

---

## 1. user-register (用户注册)

```typescript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  const { email, password, nickname } = ctx.body
  
  // 1. 参数验证
  if (!email || !password) {
    return { code: 400, message: '邮箱和密码不能为空' }
  }
  
  // 2. 检查邮箱是否已注册
  const db = cloud.database()
  const existUser = await db.collection('users').where({ email }).getOne()
  if (existUser.data) {
    return { code: 400, message: '该邮箱已被注册' }
  }
  
  // 3. 加密密码
  const bcrypt = require('bcrypt')
  const hashedPassword = await bcrypt.hash(password, 10)
  
  // 4. 生成默认头像
  const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(nickname || email.split('@')[0])}&background=random`
  
  // 5. 创建用户
  const result = await db.collection('users').add({
    email: email,
    password: hashedPassword,
    nickname: nickname || email.split('@')[0],
    avatarUrl: avatarUrl,
    createdAt: new Date(),
    updatedAt: new Date()
  })
  
  // 6. 生成 Token
  const token = cloud.getToken({
    uid: result.id,
    email: email
  })
  
  return {
    code: 0,
    message: '注册成功',
    data: {
      token: token,
      user: {
        uid: result.id,
        email: email,
        nickname: nickname || email.split('@')[0],
        avatarUrl: avatarUrl
      }
    }
  }
}
```

**依赖**: 需要安装 `bcrypt`

---

## 2. user-login (用户登录)

```typescript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  const { email, password } = ctx.body
  
  // 1. 参数验证
  if (!email || !password) {
    return { code: 400, message: '邮箱和密码不能为空' }
  }
  
  // 2. 查询用户
  const db = cloud.database()
  const user = await db.collection('users').where({ email }).getOne()
  
  if (!user.data) {
    return { code: 404, message: '用户不存在' }
  }
  
  // 3. 验证密码
  const bcrypt = require('bcrypt')
  const isMatch = await bcrypt.compare(password, user.data.password)
  
  if (!isMatch) {
    return { code: 401, message: '密码错误' }
  }
  
  // 4. 生成 Token
  const token = cloud.getToken({
    uid: user.data._id,
    email: email
  })
  
  return {
    code: 0,
    message: '登录成功',
    data: {
      token: token,
      user: {
        uid: user.data._id,
        email: user.data.email,
        nickname: user.data.nickname,
        avatarUrl: user.data.avatarUrl
      }
    }
  }
}
```

**依赖**: 需要安装 `bcrypt`

---

## 3. user-info (获取用户信息)

```typescript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  // 1. 从 Token 获取用户ID
  const user = ctx.user
  if (!user) {
    return { code: 401, message: '未登录' }
  }
  
  // 2. 查询用户信息
  const db = cloud.database()
  const userInfo = await db.collection('users')
    .where({ _id: user.uid })
    .getOne()
  
  if (!userInfo.data) {
    return { code: 404, message: '用户不存在' }
  }
  
  // 不返回密码
  delete userInfo.data.password
  
  return {
    code: 0,
    data: userInfo.data
  }
}
```

---

## 4. messages-list (获取留言列表)

```typescript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  const db = cloud.database()
  
  // 查询所有留言，按时间倒序
  const messages = await db.collection('messages')
    .orderBy('timestamp', 'desc')
    .limit(100)
    .get()
  
  return {
    code: 0,
    data: messages.data
  }
}
```

---

## 5. message-add (发布留言)

```typescript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  const { content, imageUrl } = ctx.body
  const user = ctx.user
  
  // 1. 验证登录
  if (!user) {
    return { code: 401, message: '请先登录' }
  }
  
  // 2. 验证内容
  if (!content && !imageUrl) {
    return { code: 400, message: '留言内容和图片不能同时为空' }
  }
  
  // 3. 获取用户信息
  const db = cloud.database()
  const userInfo = await db.collection('users')
    .where({ _id: user.uid })
    .getOne()
  
  if (!userInfo.data) {
    return { code: 404, message: '用户不存在' }
  }
  
  // 4. 创建留言
  const now = new Date()
  const result = await db.collection('messages').add({
    userId: user.uid,
    userName: userInfo.data.nickname,
    userAvatar: userInfo.data.avatarUrl,
    content: content || '',
    imageUrl: imageUrl || '',
    timestamp: now,
    displayTime: now.toLocaleString('zh-CN')
  })
  
  return {
    code: 0,
    message: '发布成功',
    data: result.id
  }
}
```

---

## 6. send-password-reset (发送密码重置邮件)

```typescript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  const { email } = ctx.body
  
  if (!email) {
    return { code: 400, message: '邮箱不能为空' }
  }
  
  // 1. 检查用户是否存在
  const db = cloud.database()
  const user = await db.collection('users').where({ email }).getOne()
  
  if (!user.data) {
    return { code: 404, message: '该邮箱未注册' }
  }
  
  // 2. 生成重置 Token（有效期1小时）
  const resetToken = cloud.getToken({
    uid: user.data._id,
    type: 'password-reset'
  }, 3600)  // 1小时过期
  
  // 3. 构建重置链接 (⚠️ 需要替换为您的实际域名)
  const resetLink = `https://your-app.laf.run/reset-password?token=${resetToken}`
  
  // 4. 发送邮件 (使用 Resend)
  const { Resend } = require('resend')
  const resend = new Resend('re_4tWgh2hj_6qwqn2gwUBKg38JEpmE31WSu')
  
  const { data, error } = await resend.emails.send({
    from: 'Zaoyoe <noreply@zaoyoe.com>',  // ⚠️ 需要替换为您的域名
    to: email,
    subject: '重置您的密码',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; padding: 40px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          h2 { color: #333; margin-bottom: 20px; }
          .button { display: inline-block; background: linear-gradient(135deg, #9b5de5 0%, #f15bb5 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>🔐 重置密码</h2>
          <p>您好，</p>
          <p>我们收到了您重置密码的请求。点击下方按钮完成重置：</p>
          <a href="${resetLink}" class="button">立即重置密码</a>
          <div class="warning">
            <p><strong>⏰ 重要提示：</strong>此链接将在 <strong>1 小时</strong>后失效。</p>
          </div>
          <p>如果您没有请求重置密码，请忽略此邮件。</p>
          <p>祝好，<br><strong>Zaoyoe 团队</strong></p>
        </div>
      </body>
      </html>
    `
  })
  
  if (error) {
    return { code: 500, message: '邮件发送失败: ' + error.message }
  }
  
  return {
    code: 0,
    message: '重置密码邮件已发送'
  }
}
```

**依赖**: 需要安装 `resend`

---

## 依赖安装说明

在 Laf 控制台左侧菜单：

1. 点击 **"依赖管理"**
2. 搜索并添加：
   - `bcrypt` (版本 ^5.1.1)
   - `resend` (版本 ^3.0.0)
3. 等待安装完成

---

## ⚠️ 重要：需要修改的地方

### 邮件发送函数 (send-password-reset):

1. **第26行**: 修改重置链接的域名
   ```typescript
   const resetLink = `https://YOUR-APP.laf.run/reset-password?token=${resetToken}`
   ```

2. **第31行**: 修改发件人地址（需要您的域名通过 Resend 验证）
   ```typescript
   from: 'Zaoyoe <noreply@YOUR-DOMAIN.com>',
   ```

---

## 测试云函数

创建完成后，可以在 Laf 控制台点击"调试"按钮测试每个函数。

例如测试注册：
```json
{
  "email": "test@example.com",
  "password": "123456",
  "nickname": "测试用户"
}
```
