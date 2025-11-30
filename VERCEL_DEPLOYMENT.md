# Vercel 部署指南

本指南将帮助您将网站部署到 Vercel，使国内用户可以访问 www.zaoyoe.com

## 📋 准备工作

### 1. 注册 Vercel 账号
- 访问：https://vercel.com
- 点击 "Sign Up"
- 使用 GitHub 账号登录（推荐）

### 2. 安装 Vercel CLI

在终端运行：
```bash
npm install -g vercel
```

## 🚀 部署步骤

### 方法 1：命令行部署（推荐）

#### 步骤 1：登录 Vercel
```bash
vercel login
```
- 选择登录方式（GitHub/Email）
- 在浏览器中确认授权

#### 步骤 2：部署项目
```bash
cd /Volumes/chao/AI/xianyu_profit_calculator
vercel
```

**部署过程中的选项**：
- "Set up and deploy..."? → **Y** (是)
- "Which scope..."? → 选择您的账户
- "Link to existing project?"? → **N** (否，这是新项目)
- "What's your project's name?"? → `zaoyoe` (或您喜欢的名字)
- "In which directory..."? → `.` (当前目录)
- "Want to override the settings?"? → **N** (否)

#### 步骤 3：生产环境部署
```bash
vercel --prod
```

**完成！** Vercel 会给您一个 URL，比如：`https://zaoyoe.vercel.app`

### 方法 2：GitHub 集成（自动化）

#### 步骤 1：推送到 GitHub
```bash
# 如果还没有 git 仓库
git init
git add .
git commit -m "Initial commit"

# 在 GitHub 创建仓库后
git remote add origin https://github.com/YOUR_USERNAME/zaoyoe.git
git push -u origin main
```

#### 步骤 2：连接 Vercel
1. 访问 https://vercel.com/dashboard
2. 点击 "Add New..." → "Project"
3. 选择您的 GitHub 仓库
4. 点击 "Deploy"

**优点**：以后每次 `git push` 都会自动部署！

## 🌐 配置自定义域名 (www.zaoyoe.com)

### 步骤 1：在 Vercel 添加域名

1. 进入项目的 Dashboard
2. 点击 "Settings" → "Domains"
3. 输入 `www.zaoyoe.com`
4. 点击 "Add"

### 步骤 2：配置 DNS

Vercel 会显示需要添加的 DNS 记录。在您的域名注册商（比如阿里云、腾讯云）添加：

**选项 A：CNAME 记录（推荐）**
```
类型: CNAME
主机记录: www
记录值: cname.vercel-dns.com
```

**选项 B：A 记录**
```
类型: A
主机记录: www
记录值: 76.76.21.21
```

### 步骤 3：等待 DNS 生效

- 通常需要 5-30 分钟
- Vercel 会自动配置 SSL 证书（HTTPS）

## 🔐 更新 Google OAuth 配置

部署完成后，需要在 Google Cloud Console 添加新域名：

### 已获授权的 JavaScript 来源
添加：
```
https://www.zaoyoe.com
https://zaoyoe.vercel.app
```

### 已获授权的重定向 URI
添加：
```
https://www.zaoyoe.com
https://zaoyoe.vercel.app
```

## ✅ 验证部署

访问以下 URL 测试：
- https://zaoyoe.vercel.app
- https://www.zaoyoe.com

测试功能：
- ✅ 页面能正常加载
- ✅ 留言板功能
- ✅ Google 登录（配置后）
- ✅ 邮箱密码登录

## 🔄 后续更新

### 使用命令行
```bash
# 每次修改代码后
vercel --prod
```

### 使用 GitHub（如果已配置）
```bash
git add .
git commit -m "更新说明"
git push
```
Vercel 会自动部署！

## 📝 注意事项

1. **LeanCloud 配置**
   - 确保 LeanCloud 允许来自新域名的请求
   - 在 LeanCloud 控制台添加 `www.zaoyoe.com` 到安全域名

2. **环境变量**
   - 如果有敏感信息，在 Vercel Dashboard → Settings → Environment Variables 中配置

3. **国内访问**
   - Vercel 在国内可访问，但速度可能不如阿里云
   - 如需更快速度，可以后续迁移到阿里云 OSS + CDN

## 🆘 常见问题

### 部署失败？
- 检查 `vercel.json` 配置是否正确
- 查看 Vercel Dashboard 的部署日志

### 域名无法访问？
- 确认 DNS 记录已添加
- 等待 DNS 传播（最多 48 小时，通常几分钟）
- 使用 `nslookup www.zaoyoe.com` 检查 DNS

### Google 登录不工作？
- 确认已在 Google Cloud Console 添加新域名
- 清除浏览器缓存
- 检查浏览器控制台的错误信息

## 📞 获取帮助

如遇到问题，请提供：
- Vercel 部署日志
- 浏览器控制台错误信息
- DNS 配置截图
