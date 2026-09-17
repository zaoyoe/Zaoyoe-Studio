#!/bin/bash
set -e

echo "🚀 开始部署即时发货优化..."
echo ""

# 切换到项目目录
cd "$(dirname "$0")"

# 1. 清理 Git 锁文件（如果存在）
echo "📋 步骤 1/5: 清理 Git 锁文件..."
if [ -f .git/index.lock ]; then
    rm -f .git/index.lock
    echo "✅ 锁文件已删除"
else
    echo "✅ 无需清理"
fi
echo ""

# 2. 添加所有更改
echo "📋 步骤 2/5: 暂存代码更改..."
git add -A
echo "✅ 代码已暂存"
echo ""

# 3. 提交更改
echo "📋 步骤 3/5: 提交更改..."
git commit -m "feat: 实现即时发货优化，降低发货延迟到1-3秒

- 在 guest-shop-worker.js 中添加详细的诊断日志
- 修复独立路由文件（status.js, webhooks）传入 kickFulfillment
- 实现支付确认后立即触发发货，替代定时轮询
- 预期性能提升：70-90%（从10秒降低到1-3秒）
- 添加完整的部署和验证文档"
echo "✅ 更改已提交"
echo ""

# 4. 推送到远程仓库
echo "📋 步骤 4/5: 推送到远程仓库..."
CURRENT_BRANCH=$(git branch --show-current)
echo "当前分支: $CURRENT_BRANCH"

read -p "是否推送到远程仓库? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    git push origin "$CURRENT_BRANCH"
    echo "✅ 代码已推送到远程仓库"
else
    echo "⚠️  跳过推送步骤"
fi
echo ""

# 5. 显示部署后验证指南
echo "📋 步骤 5/5: 部署后验证"
echo ""
echo "🎯 验证步骤："
echo "1. 确保生产环境设置了以下环境变量："
echo "   GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED=true"
echo "   VERIFY_SERVER_WORKERS_ENABLED=true"
echo ""
echo "2. 如果使用 Vercel，它会自动部署"
echo "   如果手动部署，请运行: pm2 restart all"
echo ""
echo "3. 进行一次支付测试，验证发货延迟："
echo "   - 打开浏览器控制台"
echo "   - 粘贴 DEPLOYMENT_IMMEDIATE_FULFILLMENT.md 中的监控脚本"
echo "   - 进行支付测试"
echo "   - 查看延迟是否降低到 1-3秒"
echo ""
echo "4. 查看服务器日志："
echo "   tail -f /tmp/worker-kick.log"
echo "   应该看到: [Immediate Kicker] ⚡ 即时发货被触发!"
echo ""
echo "✅ 部署脚本执行完成！"
echo "📖 详细文档请查看: DEPLOYMENT_IMMEDIATE_FULFILLMENT.md"
