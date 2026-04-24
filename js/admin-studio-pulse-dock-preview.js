const pulseData = {
  overview: {
    eyebrow: "TODAY QUEUE",
    title: "待办总览",
    subtitle: "只汇总需要管理员处理的事项；保存成功、服务正常、0 异常这类信息不再占 Dock 注意力。",
    priority: "11 项待处理",
    priorityClass: "is-alert",
    route: "运营总览 / 待处理",
    badge: "11",
    badgeClass: "is-alert",
    note: "这个入口用于回答一句话：现在有没有事需要我处理？正常信息进入详情，不在 Dock 上挂点。",
    metrics: [
      ["站内通知", "5 条"],
      ["支付回调", "2 条"],
      ["订单库存", "3 项"],
      ["AI 配置", "1 项"]
    ],
    actions: [
      ["处理最急", "打开 P1 站内通知，并自动筛选未处理。", "primary"],
      ["只看异常", "汇总支付、库存、AI、安全里的异常项。", ""],
      ["清理低优先", "隐藏已读成功反馈和普通正常状态。", ""]
    ],
    timeline: [
      ["P1", "用户消息 2 人待回复", "刚刚", "alert"],
      ["P2", "支付回调 2 单等待重试", "2 分钟", "warn"],
      ["P2", "低库存 3 个商品待处理", "8 分钟", "warn"]
    ]
  },
  notifications: {
    eyebrow: "INBOX",
    title: "站内通知",
    subtitle: "告警、用户消息和系统提醒统一收进右侧 Dock，点开即可回到对应页面处理。",
    priority: "P1 需处理",
    priorityClass: "is-alert",
    route: "消息中心 / 未处理",
    badge: "5",
    badgeClass: "is-alert",
    note: "把最需要响应的消息提前：用户支付疑问、管理员告警、库存提醒和系统异常，不再散落在不同页面。",
    metrics: [
      ["未读消息", "5 条"],
      ["用户待回", "2 人"],
      ["系统告警", "1 条"]
    ],
    actions: [
      ["处理消息", "跳转到消息中心，并筛选未处理。", "primary"],
      ["只看告警", "打开站内通知的告警视图。", ""],
      ["全部已读", "批量标记低优先级通知。", ""]
    ],
    timeline: [
      ["用户消息", "用户询问充值到账时间", "刚刚", "alert"],
      ["系统告警", "支付回调延迟超过 3 分钟", "2 分钟", "warn"],
      ["库存提醒", "Google One 库存接近阈值", "8 分钟", "warn"]
    ]
  },
  payments: {
    eyebrow: "PAYMENTS",
    title: "支付回调",
    subtitle: "支付、退款、回调重试和人工核验收在一个入口，异常时优先浮到右侧。",
    priority: "P2 复核",
    priorityClass: "is-warn",
    route: "支付管理 / 回调队列",
    badge: "2",
    badgeClass: "is-warn",
    note: "高频动作应该直接放在脉冲面板里：重试回调、查看订单、打开支付日志，减少来回切页。",
    metrics: [
      ["待重试", "2 单"],
      ["成功率", "98.7%"],
      ["平均延迟", "41 秒"]
    ],
    actions: [
      ["重试回调", "对筛选出的失败回调执行重试。", "primary"],
      ["查看订单", "跳转到关联订单列表。", ""],
      ["打开日志", "查看支付网关最近日志。", ""]
    ],
    timeline: [
      ["Callback", "订单 #A1029 回调等待重试", "刚刚", "warn"],
      ["Paid", "订单 #A1028 已入账", "3 分钟", "ok"],
      ["Audit", "mock 支付开关未变更", "12 分钟", "ok"]
    ]
  },
  inventory: {
    eyebrow: "COMMERCE",
    title: "订单库存",
    subtitle: "把库存阈值、异常订单、热门商品变化合并成一条经营脉冲。",
    priority: "P2 观察",
    priorityClass: "is-warn",
    route: "商品经营 / 库存预警",
    badge: "3",
    badgeClass: "is-warn",
    note: "经营类信号适合做成可处理队列：补货、下架、查看订单、调整活动，都能从这里一步进入。",
    metrics: [
      ["低库存", "3 个"],
      ["异常订单", "1 单"],
      ["今日转化", "12.4%"]
    ],
    actions: [
      ["补货处理", "打开低库存商品筛选。", "primary"],
      ["异常订单", "进入订单列表并定位异常单。", ""],
      ["调整活动", "跳转到促销配置。", ""]
    ],
    timeline: [
      ["低库存", "Google One 月卡剩余 4 件", "刚刚", "warn"],
      ["订单", "1 单等待人工确认", "6 分钟", "warn"],
      ["转化", "商品页转化较昨日提升 3.1%", "今天", "ok"]
    ]
  },
  budget: {
    eyebrow: "AI BUDGET",
    title: "AI 用量与预算",
    subtitle: "先设置预算阈值，再显示占用比例；未设置前只提示今日用量和配置入口。",
    priority: "待设置",
    priorityClass: "is-warn",
    route: "AI 设置 / 预算阈值",
    badge: "1",
    badgeClass: "is-warn",
    note: "右侧 Dock 不直接显示占比，避免误以为已经配置了预算。点“设置预算”后再展示百分比、阈值预警和降级建议。",
    metrics: [
      ["今日成本", "$12.40"],
      ["预算阈值", "未设置"],
      ["失败请求", "0 次"]
    ],
    actions: [
      ["设置预算", "进入 AI 设置，配置每日预算、提醒阈值和超限策略。", "primary"],
      ["查看用量", "打开 AI 用量明细。", ""],
      ["降级策略", "查看模型降级规则。", ""]
    ],
    timeline: [
      ["Usage", "图片分析消耗占比 42%", "刚刚", ""],
      ["Budget", "预算阈值尚未设置，暂不计算占用", "今天", "warn"],
      ["Route", "Codex Relay Ready", "今天", "ok"]
    ]
  },
  security: {
    eyebrow: "SECURITY",
    title: "安全",
    subtitle: "管理员权限、异常登录、密钥代理和支付配置变更集中核对。",
    priority: "正常",
    priorityClass: "is-ok",
    route: "安全设置 / 管理员访问",
    badge: "",
    badgeClass: "",
    note: "安全入口应该少而准：只显示异常信号、敏感变更和可回溯审计。",
    metrics: [
      ["后台访问", "200 次"],
      ["异常信号", "0 条"],
      ["密钥变更", "0 次"]
    ],
    actions: [
      ["访问审计", "打开管理员访问记录。", "primary"],
      ["登录规则", "定位到登录安全配置。", ""],
      ["导出日志", "导出最近安全日志。", ""]
    ],
    timeline: [
      ["Access", "2 位管理员 · 5 个 IP", "刚刚", "ok"],
      ["Audit", "支付配置审计 2 条", "12:46", "ok"],
      ["Key Proxy", "密钥代理状态正常", "12:42", "ok"]
    ]
  }
};

const dock = document.getElementById("pulseDock");
const pulsePanel = document.getElementById("pulsePanel");
const pulseStack = document.querySelector(".pulse-stack");
const tabs = Array.from(document.querySelectorAll(".pulse-tab"));
const dockIcons = tabs.map((tab) => tab.querySelector(".pulse-icon"));
const order = tabs.map((tab) => tab.dataset.pulse);
const title = document.getElementById("pulseTitle");
const eyebrow = document.getElementById("pulseEyebrow");
const subtitle = document.getElementById("pulseSubtitle");
const priority = document.getElementById("pulsePriority");
const route = document.getElementById("pulseRoute");
const metrics = document.getElementById("pulseMetrics");
const note = document.getElementById("pulseNote");
const actions = document.getElementById("pulseActions");
const toast = document.getElementById("pulseToast");
const timeline = document.getElementById("pulseTimeline");
let activeKey = "overview";

function setOpen(isOpen) {
  dock.classList.toggle("is-open", isOpen);
}

function applyDockIcon(icon, intensity) {
  const eased = intensity * intensity * (3 - 2 * intensity);
  icon.style.setProperty("--dock-scale", (1 + eased * 0.44).toFixed(3));
  icon.style.setProperty("--dock-rise", `${(eased * 16).toFixed(1)}px`);
  icon.style.setProperty("--dock-border", (0.08 + eased * 0.44).toFixed(3));
  icon.style.setProperty("--dock-bg", (0.045 + eased * 0.065).toFixed(3));
}

function clearDockLift() {
  dockIcons.forEach((icon) => {
    icon.style.removeProperty("--dock-scale");
    icon.style.removeProperty("--dock-rise");
    icon.style.removeProperty("--dock-border");
    icon.style.removeProperty("--dock-bg");
  });
}

function updateDockLift(event) {
  const influence = 98;
  tabs.forEach((tab, index) => {
    const rect = tab.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const distance = Math.min(Math.abs(event.clientY - centerY), influence);
    const intensity = (1 + Math.cos((distance / influence) * Math.PI)) / 2;
    applyDockIcon(dockIcons[index], intensity);
  });
}

function focusDockLift(targetTab) {
  const activeIndex = tabs.indexOf(targetTab);
  dockIcons.forEach((icon, index) => {
    const distance = Math.abs(index - activeIndex);
    const intensity = distance === 0 ? 1 : distance === 1 ? 0.36 : 0;
    applyDockIcon(icon, intensity);
  });
}

function renderDockBadges() {
  tabs.forEach((tab) => {
    const data = pulseData[tab.dataset.pulse];
    const badge = tab.querySelector("[data-badge]");
    if (!badge || !data) {
      return;
    }

    badge.className = "pulse-badge";
    badge.textContent = data.badge || "";
    if (data.badgeClass) {
      badge.classList.add(data.badgeClass);
    }
    if (data.badge) {
      badge.classList.add("is-visible");
    }
  });
}

function renderPulse(key) {
  const data = pulseData[key];
  activeKey = key;
  tabs.forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.pulse === key)));
  eyebrow.textContent = data.eyebrow;
  title.textContent = data.title;
  subtitle.textContent = data.subtitle;
  priority.className = `pulse-priority ${data.priorityClass || ""}`.trim();
  priority.textContent = data.priority;
  route.textContent = data.route;
  note.textContent = data.note;
  metrics.innerHTML = data.metrics.map(([label, value]) => `
    <div class="mini-card">
      <p class="mini-label">${label}</p>
      <p class="mini-value">${value}</p>
    </div>
  `).join("");
  actions.innerHTML = data.actions.map(([label, intent, style]) => `
    <button class="pulse-action ${style === "primary" ? "is-primary" : ""}" type="button" data-intent="${intent}">${label}</button>
  `).join("");
  toast.textContent = data.actions[0]?.[1] || data.route;
  timeline.innerHTML = data.timeline.map(([label, copy, time, state]) => `
    <div class="timeline-item ${state ? `is-${state}` : ""}">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="timeline-main">
        <div class="timeline-title">${label}</div>
        <div class="timeline-copy">${copy}</div>
      </div>
      <div class="timeline-time">${time}</div>
    </div>
  `).join("");
}

function stepPulse(direction) {
  const index = order.indexOf(activeKey);
  const next = (index + direction + order.length) % order.length;
  renderPulse(order[next]);
  setOpen(true);
}

document.getElementById("pulsePrev").addEventListener("click", () => stepPulse(-1));
document.getElementById("pulseNext").addEventListener("click", () => stepPulse(1));

actions.addEventListener("click", (event) => {
  const button = event.target.closest(".pulse-action");
  if (!button) {
    return;
  }

  toast.textContent = button.dataset.intent;
});

pulseStack.addEventListener("pointermove", updateDockLift);
pulseStack.addEventListener("pointerleave", clearDockLift);

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    renderPulse(tab.dataset.pulse);
    setOpen(true);
  });
  tab.addEventListener("focus", () => focusDockLift(tab));
  tab.addEventListener("blur", clearDockLift);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setOpen(false);
  }
});

document.addEventListener("pointerdown", (event) => {
  if (!dock.classList.contains("is-open")) {
    return;
  }

  if (pulsePanel.contains(event.target) || pulseStack.contains(event.target)) {
    return;
  }

  setOpen(false);
});

renderDockBadges();
renderPulse(activeKey);
