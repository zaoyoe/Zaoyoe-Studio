# LeanCloud 完整配置指南

## 🌟 什么是 LeanCloud？

LeanCloud 是**国产版 Firebase**，提供：
- 👤 用户认证系统
- 🗄️ 数据存储（类似 Firestore）
- 📦 文件存储
- ☁️ 云函数
- 🚀 **完全免费**（开发版）
- 🇨🇳 国内访问速度极快

---

## 📋 第一步：注册 LeanCloud 账号

### 1. 访问官网
打开浏览器，访问：**https://www.leancloud.app**

### 2. 点击"免费注册"

### 3. 选择注册方式
- **推荐**：使用手机号注册
- 可选：使用邮箱注册

### 4. 完成注册
填写手机号/邮箱，设置密码

---

## 🆔 第二步：实名认证（必须）

LeanCloud 开发版**必须完成实名认证**。

### 1. 登录后进入控制台

### 2. 系统会提示实名认证

### 3. 填写信息：
- 真实姓名
- 身份证号
- 上传身份证正反面照片

### 4. 提交审核
- 通常 **1-3 小时**内完成
- 最快可能几分钟

⏰ **等待审核期间可以继续下一步**

---

## 🚀 第三步：创建应用

### 1. 进入控制台
实名认证提交后，进入"应用控制台"

### 2. 点击"创建应用"

### 3. 填写应用信息：
- **应用名称**：`xianyu-calculator` 或任意名称
- **套餐类型**：选择 **"开发版"**（免费）

### 4. 选择节点
- **华北节点** 或 **华东节点**（推荐，国内速度快）

### 5. 点击"创建"

---

## 🔑 第四步：获取密钥（重要！）

创建应用后：

### 1. 进入应用设置
点击刚创建的应用 → **"设置"** → **"应用凭证"**

### 2. 复制以下信息：
- **AppID**：类似 `abcd1234EFGH5678ijkl`
- **AppKey**：类似 `XYZabc123DEF456ghi789`
- **REST API 服务器地址**：类似 `https://xxxxxx.api.lncldglobal.com`

**⚠️ 请保存这些信息！**

---

## 🗂️ 第五步：创建数据表

### 1. 进入数据存储
左侧菜单 → **"数据存储"** → **"结构化数据"**

### 2. 创建 Message 表

点击 **"创建 Class"**：
- **Class 名称**：`Message`
- **Class 权限**：默认即可

点击"创建"

### 3. 添加字段

进入 `Message` 表，点击 **"添加列"**：

| 列名 | 类型 | 必填 | 说明 |
|------|------|------|------|
| userName | String | ✅ | 用户昵称 |
| userAvatar | String | | 用户头像URL |
| content | String | | 留言内容 |
| imageUrl | String | | 图片URL |
| user | Pointer → _User | ✅ | 关联用户 |

### 4. 用户表（_User）
系统自动创建，无需手动添加。

**默认字段**：
- username（用户名）
- password（密码，自动加密）
- email（邮箱）

**需要添加的字段**：
- 进入 `_User` 表
- 添加列：
  - `nickname` (String) - 昵称
  - `avatarUrl` (String) - 头像URL

---

## 🎨 第六步：配置权限（ACL）

### 1. 进入 Message 表设置
点击 `Message` 表 → **"其他"** → **"Class 权限"**

### 2. 设置权限：
- ✅ **所有人可读**（find, get）
- ✅ **登录用户可写**（create）
- ❌ 修改/删除权限根据需要设置

### 3. 保存

---

## ✅ 第七步：测试连接（可选）

### 在浏览器控制台测试：

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/leancloud-storage@4.15.2/dist/av-min.js"></script>
</head>
<body>
  <script>
    // 初始化
    AV.init({
      appId: '您的AppID',
      appKey: '您的AppKey',
      serverURL: '您的服务器地址'
    });
    
    // 测试查询
    const query = new AV.Query('Message');
    query.find().then(messages => {
      console.log('✅ LeanCloud 连接成功！');
      console.log('留言数量:', messages.length);
    }).catch(error => {
      console.error('❌ 连接失败:', error);
    });
  </script>
</body>
</html>
```

---

## 📝 完成后您会拥有：

1. ✅ LeanCloud 账号（已实名）
2. ✅ 应用（zaoyoe 或其他名称）
3. ✅ AppID 和 AppKey
4. ✅ 数据表（_User, Message）
5. ✅ 权限配置

---

## 🎯 下一步

请查看 `LEANCLOUD_CODE_GUIDE.md` 获取前端代码改写指南！

---

## 🆘 常见问题

### Q: 实名认证需要多久？
**A**: 通常 1-3 小时，最快几分钟

### Q: 开发版有什么限制？
**A**: 
- API 请求：3万次/天（小项目完全够用）
- 数据存储：1GB
- **商用需绑定已备案域名**

### Q: 如何升级到商用版？
**A**: 
1. 域名完成备案
2. 在 LeanCloud 绑定域名
3. 选择付费套餐

### Q: 数据安全吗？
**A**: 
- ✅ LeanCloud 是正规公司，数据安全有保障
- ✅ 可随时导出数据
- ✅ 支持数据备份

---

**祝您配置顺利！** 🎉
