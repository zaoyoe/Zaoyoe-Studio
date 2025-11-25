# Laf 完整配置指南

## 🐸 什么是 Laf？

Laf 是**国产版 Firebase**，提供：
- ☁️ 云函数 (类似 Firebase Functions)
- 🗄️ MongoDB 数据库 (类似 Firestore)
- 🔐 认证系统
- 📦 对象存储 (类似 Storage)
- 🚀 国内访问速度极快

---

## 📋 第一步：注册 Laf 账号

### 1. 访问官网
打开浏览器，访问：**https://laf.run**

### 2. 点击"免费使用"
- 选择手机号注册或微信扫码
- **推荐**：使用手机号（+86）

### 3. 填写信息
- 输入手机号
- 输入验证码
- 设置密码（建议用强密码）

### 4. 完成注册
注册成功后会自动跳转到控制台

---

## 🚀 第二步：创建应用

### 1. 进入控制台
点击右上角 **"创建应用"**

### 2. 填写应用信息
- **应用名称**：`xianyu-calculator` 或任意名称
- **选择区域**：
  - 🔥 **杭州** (推荐，阿里云节点，速度快)
  - 北京 (腾讯云节点)
  - 上海
- **规格**：选择 **免费版**（足够小型项目使用）

### 3. 创建

点击"创建"，等待 10-30 秒

### 4. 获取访问地址
创建成功后，您会看到：
- **应用地址**：`https://your-app-name.laf.run`
- 这就是您的**测试域名**，可以立即使用！

---

## 🗄️ 第三步：创建数据库集合

### 1. 进入数据库管理
在左侧菜单点击 **"数据库"**

### 2. 创建 Users 集合
1. 点击 **"新建集合"**
2. 集合名称：`users`
3. 点击"确定"

### 3. 创建 Messages 集合
重复上述步骤，创建 `messages` 集合

### 4. (可选) 添加索引
- 点击 `users` 集合
- 点击 **"索引"** 标签
- 添加索引：
  - 字段：`email`
  - 类型：**唯一索引**（防止重复注册）

---

## ☁️ 第四步：创建云函数

### 1. 进入云函数编辑器
左侧菜单点击 **"云函数"**

### 2. 创建注册函数 `user-register`

点击 **"新建"**，填写：
- **函数名称**：`user-register`
- **描述**：用户注册

代码如下（先复制粘贴，后面会详细讲解）：

```javascript
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
  
  // 4. 创建用户
  const result = await db.collection('users').add({
    email: email,
    password: hashedPassword,
    nickname: nickname || email.split('@')[0],
    avatarUrl: '',
    createdAt: new Date(),
    updatedAt: new Date()
  })
  
  // 5. 生成 Token
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
        nickname: nickname || email.split('@')[0]
      }
    }
  }
}
```

**点击右上角"保存"并"发布"**

### 3. 安装依赖（bcrypt）
1. 点击左侧 **"依赖管理"**
2. 搜索：`bcrypt`
3. 点击"添加"
4. 等待安装完成（约1分钟）

### 4. 创建登录函数 `user-login`

再次点击 **"新建"**：
- **函数名称**：`user-login`

代码：

```javascript
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

**保存并发布**

### 5. 创建获取用户信息函数 `user-info`

```javascript
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

**保存并发布**

### 6. 创建留言板查询函数 `messages-list`

```javascript
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

### 7. 创建发布留言函数 `message-add`

```javascript
import cloud from '@lafjs/cloud'

export async function main(ctx: FunctionContext) {
  const { content, imageUrl } = ctx.body
  const user = ctx.user
  
  // 1. 验证登录
  if (!user) {
    return { code: 401, message: '请先登录' }
  }
  
  // 2. 获取用户信息
  const db = cloud.database()
  const userInfo = await db.collection('users')
    .where({ _id: user.uid })
    .getOne()
  
  // 3. 创建留言
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

**保存并发布**

### 8. 创建密码重置函数 `send-password-reset`

```javascript
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
  
  // 3. 构建重置链接
  const resetLink = `https://your-app.laf.run/reset-password?token=${resetToken}`
  
  // 4. 发送邮件 (使用 Resend)
  const { Resend } = require('resend')
  const resend = new Resend('re_4tWgh2hj_6qwqn2gwUBKg38JEpmE31WSu')
  
  const { data, error } = await resend.emails.send({
    from: 'Zaoyoe <noreply@zaoyoe.com>',
    to: email,
    subject: '重置您的密码',
    html: `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>重置密码</h2>
        <p>您好，</p>
        <p>我们收到了您重置密码的请求。点击下方按钮完成重置：</p>
        <a href="${resetLink}" style="display: inline-block; background: #9b5de5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; margin: 20px 0;">立即重置密码</a>
        <p>此链接将在 1 小时后失效。</p>
        <p>如果您没有请求重置密码，请忽略此邮件。</p>
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

**保存并发布**

然后添加 `resend` 依赖：
- 依赖管理 → 搜索 `resend` → 添加

---

## 🎨 第五步：前端迁移

### 1. 安装 Laf SDK

在项目根目录执行：

```bash
npm install laf-client-sdk
```

(如果没有 npm，可以先跳过，直接用 CDN)

### 2. 创建 Laf 初始化文件

创建新文件 `/Volumes/chao/AI/xianyu_profit_calculator/laf-init.js`:

```javascript
// Laf 初始化配置
import { Cloud } from 'laf-client-sdk'

// 替换为您的实际应用地址
const cloud = new Cloud({
  baseUrl: 'https://YOUR-APP-NAME.laf.run',  // ⚠️ 替换这里！
  dbProxyUrl: '/proxy/db',
  getAccessToken: () => localStorage.getItem('laf_token')
})

// 全局导出
window.lafCloud = cloud

// 辅助函数：检查登录状态
window.checkLoginStatus = async function() {
  const token = localStorage.getItem('laf_token')
  if (!token) return null
  
  try {
    const res = await cloud.invoke('user-info')
    if (res.code === 0) {
      return res.data
    }
  } catch (e) {
    localStorage.removeItem('laf_token')
  }
  return null
}

console.log('Laf SDK 初始化完成')
```

### 3. 在 HTML 引入

修改 `index.html`，**移除 Firebase SDK**，添加 Laf：

找到 `<head>` 区域，删除所有 Firebase 相关的 `<script>` 标签，替换为：

```html
<!-- Laf SDK -->
<script type="module" src="./laf-init.js"></script>
```

---

## 🔄 第六步：改写前端代码

### 注册功能改写

**原 Firebase 代码** (script.js 约 600行)：
```javascript
const userCredential = await window.createUserWithEmailAndPassword(
  window.firebaseAuth,
  email,
  password
);
```

**新 Laf 代码**：
```javascript
const result = await window.lafCloud.invoke('user-register', {
  email: email,
  password: password,
  nickname: nickname
});

if (result.code === 0) {
  localStorage.setItem('laf_token', result.data.token);
  localStorage.setItem('cached_user_profile', JSON.stringify(result.data.user));
  // 注册成功逻辑...
} else {
  alert('注册失败: ' + result.message);
}
```

### 登录功能改写

**原代码**：
```javascript
await window.signInWithEmailAndPassword(window.firebaseAuth, email, password);
```

**新代码**：
```javascript
const result = await window.lafCloud.invoke('user-login', {
  email: email,
  password: password
});

if (result.code === 0) {
  localStorage.setItem('laf_token', result.data.token);
  localStorage.setItem('cached_user_profile', JSON.stringify(result.data.user));
  // 登录成功...
} else {
  alert('登录失败: ' + result.message);
}
```

### 留言板加载改写

**原代码**：
```javascript
const q = query(collection(db, 'messages'), orderBy('timestamp', 'desc'));
const querySnapshot = await getDocs(q);
```

**新代码**：
```javascript
const result = await window.lafCloud.invoke('messages-list');
if (result.code === 0) {
  const messages = result.data;
  // 处理留言数据...
}
```

### 发送留言改写

**原代码**：
```javascript
await addDoc(collection(window.firebaseDB, 'messages'), messageData);
```

**新代码**：
```javascript
const result = await window.lafCloud.invoke('message-add', {
  content: message,
  imageUrl: imageUrl
});

if (result.code === 0) {
  alert('发布成功！');
} else {
  alert('发布失败: ' + result.message);
}
```

---

## ✅ 第七步：测试

### 1. 本地测试
启动本地服务器：
```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
python3 -m http.server 8000
```

打开浏览器：http://localhost:8000

### 2. 测试注册
- 输入邮箱、密码、昵称
- 点击注册
- 检查是否成功

### 3. 测试登录
- 输入刚注册的邮箱密码
- 点击登录

### 4. 测试留言板
- 发送一条留言
- 刷新页面查看是否显示

---

## 🚀 第八步：部署到 Vercel

### 1. 推送代码到 GitHub
```bash
git add .
git commit -m "迁移到 Laf"
git push
```

### 2. Vercel 自动部署
Vercel 会自动检测变更并重新部署

### 3. 获取生产地址
部署完成后，您的网站地址：`https://your-project.vercel.app`

---

## 🎉 完成！

现在您的网站：
- ✅ 国内用户可直接访问（无需翻墙）
- ✅ 使用 Laf 测试域名（xxx.laf.run）
- ✅ 所有功能正常
- ✅ 等备案通过后绑定 zaoyoe.com

---

## 🆘 常见问题

### Q: 云函数报错怎么办？
**A**: 查看 Laf 控制台 → 日志，会显示详细错误

### Q: 数据库连接失败？
**A**: 检查 `baseUrl` 是否正确填写

### Q: 前端调用失败？
**A**: 打开浏览器开发者工具 (F12)，查看 Console 和 Network

---

**需要我现在帮您改写具体的代码文件吗？** 🚀
