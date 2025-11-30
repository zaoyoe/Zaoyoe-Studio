---
description: 手动上传代码更新网站（不用命令行）
---

# 手动上传代码到 GitHub（让 Vercel 自动部署）

## 方法一：直接在 GitHub 网页编辑（最快，5分钟）

适合：**修改单个文件**（如改 CSS、JS）

### 步骤

1. **打开浏览器，访问您的仓库**
   ```
   https://github.com/zaoyoe/Zaoyoe-Studio
   ```

2. **找到要修改的文件**
   - 在文件列表中点击文件名（如 `style.css`）
   - 浏览器会显示文件内容

3. **点击右上角的"编辑"按钮**
   - 铅笔图标 ✏️（Edit this file）
   - 进入编辑模式

4. **修改代码**
   - 可以按 `Ctrl + F` (Windows) 或 `Command + F` (Mac) 搜索要改的地方
   - 直接修改代码

5. **提交更改**
   - 滚动到页面底部
   - 在 "Commit message" 输入框填写修改说明（如 `fix: 修复手机端样式`）
   - 点击绿色的 **"Commit changes"** 按钮

6. **Vercel 自动部署**
   - GitHub 提交后，Vercel 会自动检测到更新
   - 约 1-2 分钟后，网站自动更新
   - 访问 `www.zaoyoe.com` 即可看到新版本

---

## 方法二：使用 GitHub Desktop（推荐，适合大量修改）

适合：**修改多个文件**或**频繁更新**

### 初次设置

1. **下载 GitHub Desktop**
   - 访问：https://desktop.github.com/
   - 下载并安装（支持 Mac 和 Windows）

2. **登录 GitHub 账号**
   - 打开 GitHub Desktop
   - 点击 "Sign in to GitHub.com"
   - 输入您的 GitHub 账号和密码

3. **克隆您的仓库（只需做一次）**
   - 点击菜单 `File` → `Clone repository...`
   - 在列表中找到 `zaoyoe/Zaoyoe-Studio`
   - 选择本地保存路径（如 `~/Documents/Zaoyoe-Studio`）
   - 点击 `Clone`

### 日常使用流程

1. **本地修改代码**
   - 用任何编辑器（VS Code、记事本等）修改项目文件
   - 保存文件

2. **打开 GitHub Desktop**
   - 会自动检测到修改的文件
   - 左侧列出所有改动

3. **提交更改**
   - 在左下角 "Summary" 输入修改说明（如 `修复手机端卡片透明度`）
   - 点击蓝色的 **"Commit to main"** 按钮

4. **推送到 GitHub**
   - 点击右上角的 **"Push origin"** 按钮
   - 等待上传完成

5. **Vercel 自动部署**
   - 推送成功后，Vercel 自动构建并部署
   - 约 1-2 分钟后，网站更新

---

## 如何确认部署成功？

### 方法一：查看 Vercel 控制台
1. 访问：https://vercel.com/
2. 登录您的账号
3. 点击项目名称
4. 查看最新的部署状态（绿色 ✓ = 成功）

### 方法二：清除缓存验证
1. 在手机/电脑浏览器中，按 `Ctrl + Shift + R` (Windows) 或 `Command + Shift + R` (Mac) 强制刷新
2. 或者使用**无痕模式**打开网站
3. 检查修改是否生效

---

## 📌 推荐方案

- **小修改**（改几行 CSS）→ 用 **GitHub 网页编辑**（最快）
- **大修改**（多个文件）→ 用 **GitHub Desktop**（更方便）
- **学习阶段** → 先用 **GitHub 网页编辑**，熟悉流程后再用 GitHub Desktop

---

## ⚠️ 注意事项

1. **每次修改后都要清除浏览器缓存**，否则可能看不到最新版本
2. **Vercel 部署需要 1-2 分钟**，不要修改后立即查看（可能还是旧版本）
3. **GitHub Desktop 会覆盖本地文件**，首次克隆前请备份重要数据
