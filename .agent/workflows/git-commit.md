---
description: Git 提交代码到 GitHub
---

# Git 提交工作流

## ⚠️ 重要注意事项

### Zsh 终端的特殊字符问题

**在 Mac 的 Zsh 终端中，提交信息必须使用单引号 `'` 而不是双引号 `"`！**

- ✅ **正确**：`git commit -m 'fix: add !important to CSS'`
- ❌ **错误**：`git commit -m "fix: add !important to CSS"` （会卡住或报错）

**原因**：
- 双引号 `"` 会让 Zsh 解释特殊字符（如 `!`、`$`、`\``）
- 单引号 `'` 会把所有内容当作纯文本

---

## 标准提交流程

1. **查看当前状态**
```bash
git status
```

2. **添加修改的文件**
```bash
git add <文件名>
# 或添加所有修改
git add .
```

3. **提交（使用单引号）**
```bash
git commit -m '描述本次修改'
```

4. **推送到 GitHub**
```bash
git push origin main
```

---

## 常见问题

### Q: 提交信息中包含特殊字符怎么办？
A: 一律使用**单引号 `'`** 包裹提交信息，确保安全。

### Q: 如果 git push 卡住了怎么办？
A: 
1. 检查网络连接
2. 检查是否开启了代理（如 Clash）
3. 如果是 SSH 问题，考虑改用 HTTPS
4. 最后的方案：直接在 GitHub 网页上编辑文件
