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

### ⚠️ 域名已被占用解决办法 (Domain Already Assigned)

如果添加域名时提示 **"Domain is already assigned to another project"**，请按照以下步骤操作：

#### 方法 A：在当前项目强制认领（推荐）
1. 打开 Vercel 控制台：https://vercel.com/dashboard
2. 点击您刚部署的新项目（例如 `zaoyoe`）。
3. 点击顶部的 **Settings** (设置) 选项卡。
4. 点击左侧的 **Domains** (域名) 菜单。
5. 在输入框中输入 `www.zaoyoe.com`。
6. 点击 **Add**。
7. Vercel 会提示域名已被占用，并显示一个错误信息。
8. 仔细查看错误信息下方，通常会有一个 **"Move to [Project Name]"** (移动到当前项目) 的按钮。
9. 点击该按钮确认移动。

#### 方法 B：从旧项目移除（如果方法 A 不行）
1. 在 Vercel 控制台找到**旧的**项目（之前绑定过这个域名的项目）。
2. 进入旧项目的 **Settings** -> **Domains**。
3. 找到 `www.zaoyoe.com`，点击右侧的 **Edit** 或 **Remove** 按钮将其删除。
4. 回到**新项目**的 **Settings** -> **Domains**。
5. 重新添加 `www.zaoyoe.com`。

### DNS 配置 (如果需要重新配置)

如果 Vercel 提示 DNS 配置错误，请在您的域名服务商处添加：

**CNAME 记录**
```
类型: CNAME
主机记录: www
记录值: cname.vercel-dns.com
```

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
