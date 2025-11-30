#!/bin/bash

# 使用端口8000启动服务器（避免端口冲突）

echo "🚀 启动本地开发服务器..."
echo "📁 项目目录: $(pwd)"
echo ""
echo "🌐 服务器地址: http://localhost:8000"
echo "📄 主页: http://localhost:8000/index.html"
echo "💬 留言板: http://localhost:8000/guestbook.html"
echo ""
echo "✨ 提示：请在浏览器中访问上述地址"
echo "⚠️  不要直接双击HTML文件！"
echo ""
echo "按 Ctrl+C 停止服务器"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

python3 -m http.server 8000
