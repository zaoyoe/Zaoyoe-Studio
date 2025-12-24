# Gallery 新评论实时通知测试方案

## 测试目标
验证 Gallery 页面（prompts.html）的 Supabase Realtime 评论通知功能是否正常工作。

---

## 测试环境

### 前置条件
- [x] 本地服务器运行在 `http://localhost:8000`
- [x] Supabase 项目配置正确，Realtime 功能已启用
- [x] 准备 2 个测试账号（或使用 2 个浏览器隐身窗口）

### 测试工具
- Chrome/Safari（浏览器 1 - 用户 A）
- Firefox/Chrome 隐身模式（浏览器 2 - 用户 B）
- 开发者工具（Console + Network）

---

## 测试用例

### ✅ 测试用例 1：当前 Modal 内的实时评论

**目的：** 验证在打开的 Modal 中能实时看到其他用户的新评论

**步骤：**
1. 用户 A 访问 `http://localhost:8000/prompts.html`
2. 用户 A 点击任意 Gallery 卡片，打开 Prompt Modal
3. 用户 A 点击评论按钮（💬）进入评论区
4. 用户 B 在浏览器 2 打开相同的 Prompt
5. 用户 B 发送评论："测试实时通知 - Case 1"
6. 观察用户 A 的评论列表

**预期结果：**
- ✅ 用户 A 的评论区**自动显示**用户 B 的新评论
- ✅ 新评论带有淡入动画（从上方滑入，持续 0.5s）
- ✅ 评论数量徽章自动 +1
- ✅ 无需刷新页面

**验证方法：**
```javascript
// 在用户 A 的浏览器 Console 执行
const commentList = document.getElementById('commentList');
const lastComment = commentList.lastElementChild;
console.log('最新评论内容:', lastComment.querySelector('.comment-content').textContent);
console.log('评论总数:', document.getElementById('commentCountBadge').textContent);
```

---

### ✅ 测试用例 2：Gallery 卡片评论数实时更新

**目的：** 验证未打开的 Prompt 卡片上的评论数能自动更新

**步骤：**
1. 用户 A 打开 Gallery 页面，**不打开任何 Modal**
2. 在浏览器 Console 记录某个卡片的评论数：
   ```javascript
   const card = document.querySelector('.gallery-card');
   const countEl = card.querySelector('.comment-count');
   console.log('初始评论数:', countEl.textContent);
   ```
3. 用户 B 在该 Prompt 下发送新评论
4. 观察用户 A 的 Gallery 卡片

**预期结果：**
- ✅ 卡片评论数自动 +1
- ✅ 无页面刷新
- ✅ 其他卡片数量不变

**验证方法：**
```javascript
// 用户 A Console 检查更新后的数量
console.log('更新后评论数:', countEl.textContent);
```

---

### ✅ 测试用例 3：乐观更新（忽略自己的评论）

**目的：** 验证用户发送的评论会立即显示，且不会因 Realtime 触发重复

**步骤：**
1. 用户 A 打开 Prompt Modal，进入评论区
2. 用户 A 发送评论："我的测试评论 - Case 3"
3. 立即观察评论列表

**预期结果：**
- ✅ 评论立即显示（乐观渲染）
- ✅ **不会出现 2 条相同评论**
- ✅ 评论数量只 +1

**验证方法：**
```javascript
// 检查是否有重复评论
const comments = Array.from(document.querySelectorAll('.comment-content'));
const texts = comments.map(c => c.textContent);
const hasDuplicate = texts.length !== new Set(texts).size;
console.log('是否有重复评论:', hasDuplicate); // 应为 false
```

---

### ✅ 测试用例 4：多 Prompt 并发评论

**目的：** 验证多个 Prompt 同时有新评论时，系统能正确分发

**步骤：**
1. 用户 A 打开 Prompt #1 的 Modal 并进入评论区
2. 用户 B 在 Prompt #2 下发送评论
3. 用户 B 在 Prompt #1 下发送评论
4. 观察用户 A 的界面

**预期结果：**
- ✅ Prompt #1 的评论区显示新评论（实时插入）
- ✅ Prompt #2 的卡片评论数更新（后台更新）
- ✅ 无交叉污染或错误显示

---

### ✅ 测试用例 5：Realtime 连接状态

**目的：** 验证 Realtime 订阅是否正确建立

**步骤：**
1. 打开 Gallery 页面
2. 打开浏览器 Console
3. 执行检查脚本：

**验证方法：**
```javascript
// 检查 Realtime Channel 是否存在
if (typeof realtimeChannel !== 'undefined') {
    console.log('✅ Realtime Channel 已初始化');
    console.log('Channel 状态:', realtimeChannel.state);
} else {
    console.error('❌ Realtime Channel 未初始化');
}

// 检查 Supabase 连接
if (window.supabaseClient) {
    console.log('✅ Supabase Client 已连接');
} else {
    console.error('❌ Supabase Client 未连接');
}
```

**预期结果：**
- ✅ Console 输出 "Realtime Channel 已初始化"
- ✅ Channel 状态为 "joined" 或 "subscribed"

---

### ✅ 测试用例 6：网络中断与恢复

**目的：** 验证网络异常时的容错能力

**步骤：**
1. 用户 A 打开 Gallery 页面
2. 打开 DevTools → Network → 选择 "Offline"
3. 用户 B 发送评论
4. 用户 A 恢复网络（Network → "Online"）
5. 等待 5-10 秒

**预期结果：**
- ✅ 网络恢复后，Realtime 自动重连
- ✅ 评论数最终同步到正确状态
- ✅ Console 无 uncaught errors

**验证方法：**
观察 Console 的网络日志，应看到类似：
```
[Supabase] Realtime connection lost
[Supabase] Attempting to reconnect...
[Supabase] Realtime connection restored
```

---

## 测试检查清单

### 功能验证
- [ ] 当前 Modal 实时显示新评论（场景 1）
- [ ] Gallery 卡片评论数实时更新（场景 2）
- [ ] 乐观更新无重复评论（场景 3）
- [ ] 多 Prompt 并发正确分发（场景 4）
- [ ] Realtime 连接状态正常（场景 5）
- [ ] 网络中断后能恢复（场景 6）

### 视觉验证
- [ ] 新评论淡入动画流畅（0.5s fadeIn）
- [ ] 评论数量徽章正确更新
- [ ] 无 DOM 闪烁或抖动
- [ ] 评论头像正确显示

### 性能验证
- [ ] Console 无错误信息
- [ ] Network 标签无异常请求
- [ ] 内存使用无明显增长（长时间测试）

---

## 常见问题排查

### ❌ 问题 1：评论不实时显示

**可能原因：**
- Supabase Realtime 未启用
- 数据库权限配置错误
- Channel 未正确订阅

**排查方法：**
```javascript
// Console 检查
console.log('Channel:', realtimeChannel);
console.log('State:', realtimeChannel?.state);

// 重新订阅
if (window.supabaseClient) {
    initCommentRealtime();
}
```

---

### ❌ 问题 2：评论重复显示

**可能原因：**
- 乐观更新逻辑失效
- 用户 ID 判断错误

**排查方法：**
```javascript
// 检查 handleRealtimeCommentInsert 是否正确过滤自己的评论
// 在该函数内添加 console.log
console.log('Comment user_id:', comment.user_id);
console.log('Current user_id:', user.id);
console.log('Should ignore:', comment.user_id === user.id);
```

---

### ❌ 问题 3：评论数不更新

**可能原因：**
- 选择器错误（`.comment-count` 不存在）
- Gallery 卡片未正确匹配 `promptId`

**排查方法：**
```javascript
// 检查卡片结构
const cards = document.querySelectorAll('.gallery-card');
cards.forEach(card => {
    console.log('Card promptId:', card.dataset.promptId);
    console.log('Has count element:', !!card.querySelector('.comment-count'));
});
```

---

## 测试报告模板

### 测试日期
[填写测试日期]

### 测试人员
[填写测试人员]

### 测试结果总览
| 测试用例 | 状态 | 备注 |
|---------|------|------|
| 用例 1：Modal 实时评论 | ✅/❌ | |
| 用例 2：卡片计数更新 | ✅/❌ | |
| 用例 3：乐观更新 | ✅/❌ | |
| 用例 4：并发评论 | ✅/❌ | |
| 用例 5：连接状态 | ✅/❌ | |
| 用例 6：网络恢复 | ✅/❌ | |

### 发现的问题
[记录测试中发现的 Bug 或异常]

### 改进建议
[记录可优化的地方]

---

## 自动化测试脚本（可选）

如需编写自动化测试，可使用 Playwright 或 Puppeteer：

```javascript
// test-realtime-comments.spec.js
const { chromium } = require('playwright');

(async () => {
  // 启动两个浏览器上下文（模拟两个用户）
  const browser = await chromium.launch({ headless: false });
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  
  // 用户 A 打开页面
  await pageA.goto('http://localhost:8000/prompts.html');
  
  // 用户 B 打开页面
  await pageB.goto('http://localhost:8000/prompts.html');
  
  // ... 后续测试逻辑
  
  await browser.close();
})();
```

---

## 测试完成标准

✅ 所有 6 个测试用例通过  
✅ Console 无错误信息  
✅ 动画效果流畅  
✅ 网络异常能正常恢复  
✅ 长时间运行无内存泄漏  

---

**测试文档版本：** v1.0  
**最后更新：** 2025-12-23
