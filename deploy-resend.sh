#!/bin/bash

# Resend集成部署脚本
# 请在终端中执行此脚本

echo "🚀 开始 Resend 集成部署..."
echo ""

# 1. Firebase 登录
echo "步骤 1/5: Firebase 登录"
echo "这将打开浏览器，请选择您的 Google 账号..."
npx firebase login

# 2. 设置 Resend API Key
echo ""
echo "步骤 2/5: 配置 Resend API Key"
npx firebase functions:config:set resend.apikey="re_4tWgh2hj_6qwqn2gwUBKg38JEpmE31WSu"

# 3. 安装 Functions 依赖
echo ""
echo "步骤 3/5: 安装 Cloud Functions 依赖"
cd functions
npm install

# 4. 初始化 Firebase（如果需要）
echo ""
echo "步骤 4/5: 初始化 Firebase 项目"
cd ..
npx firebase init functions --project zaoyoe-9bdf2

# 5. 部署 Functions
echo ""
echo "步骤 5/5: 部署 Cloud Functions"
npx firebase deploy --only functions

echo ""
echo "✅ 部署完成！"
echo "现在您可以测试密码找回功能了。"
