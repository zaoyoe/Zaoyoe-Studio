# 钱包「卡券」信息架构与联动方案

这份方案聚焦两个问题：

1. 用户侧如何把“卡券包”收口成钱包里的 `卡券` 入口
2. 结合现有后台卡券能力，哪些业务入口最适合优先接入发券联动

方案基于当前代码现状整理，目标不是一次把所有营销能力都堆进钱包，而是先把用户能感知的资产入口做清楚，再把最值钱的触发点接上。

相关实现参考：

- [js/components/WalletModal.js](/Volumes/chao/AI/xianyu_profit_calculator/js/components/WalletModal.js)
- [js/shop-client.js](/Volumes/chao/AI/xianyu_profit_calculator/js/shop-client.js)
- [server/api-handlers/public/shop.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/public/shop.js)
- [server/api-handlers/admin/discounts/assets.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/discounts/assets.js)
- [server/api-handlers/admin/discounts/detail.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/discounts/detail.js)
- [server/api-handlers/admin/marketing/assets-center.js](/Volumes/chao/AI/xianyu_profit_calculator/server/api-handlers/admin/marketing/assets-center.js)
- [supabase/migrations/20260409_discount_v2_p1_assets_funnel.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_discount_v2_p1_assets_funnel.sql)
- [supabase/migrations/20260409_discount_v2_p2_marketing_assets_workflows_stacking.sql](/Volumes/chao/AI/xianyu_profit_calculator/supabase/migrations/20260409_discount_v2_p2_marketing_assets_workflows_stacking.sql)

## 1. 当前现状

当前钱包左侧导航为：

- `余额`
- `充值`
- `记录`
- `推广`
- `签到`

当前商城结算弹层已经具备卡券能力：

- 可加载用户当前持有的可用卡券
- 可加载当前商品下可领取的公开券
- 支持领取后立刻使用
- 支持传入 `discount_asset_id` 做预校验和下单
- 支持在退款时把卡券资产自动恢复

当前后台已经具备的能力包括：

- 优惠券分发模式：`general_code` / `public_claim` / `user_assigned`
- 资产表：`discount_user_assets`
- 漏斗事件表：`discount_event_logs`
- 站点、人群、渠道、活动标签字段
- 定向发券、按标签发券
- 风控自动停券、自动恢复、观察期恢复
- 优惠券详情页查看资产、漏斗、分群、风险、净收入
- 营销资产中心统一看优惠券、兑换码/套餐、工作流

当前仍缺一个明显断点：

- 用户侧还没有独立的“我的卡券”总览入口
- `available-discounts` 是结算态接口，依赖 `productId`
- 钱包里还没有“按用户维度”拉取全部卡券资产的独立接口

## 2. 用户侧信息架构

### 2.1 导航位置

建议把 `卡券` 放在左侧 `余额` 下方，形成“资产优先、动作次之”的结构：

- `余额`
- `卡券`
- `充值`
- `记录`
- `推广`
- `签到`

理由：

- `余额` 和 `卡券` 都是用户已经拥有、后续可以消费的资产
- `充值` 和 `记录` 更偏动作与历史
- 与当前两字导航保持一致，视觉上更整齐

### 2.2 卡券页结构

建议 `卡券` 页分成 3 层：

1. 资产概览区
2. 状态分组区
3. 列表明细区

#### 资产概览区

建议展示 3 个数字：

- `可用卡券`
- `即将过期`
- `累计节省`

其中：

- `可用卡券` 用于驱动点击和使用
- `即将过期` 用于提醒转化
- `累计节省` 用于加强用户对卡券价值的感知

#### 状态分组区

建议首期只做 3 个 Tab：

- `可用`
- `已使用`
- `已失效`

说明：

- `已失效` 先合并 `expired` 与 `revoked`
- 不建议首期把状态拆得太细，否则用户理解成本高
- 如果后续要加“待领取”，应放在卡券页二级模块，而不是独立主 Tab

#### 列表明细区

每张卡券建议展示：

- 券面主文案：如 `立减 20` / `9 折`
- 适用范围：全站 / 指定分类 / 指定商品
- 有效期：`2026-04-30 23:59 前可用`
- 渠道标签：如 `签到奖励` / `新客礼包` / `推广邀请`
- 状态提示：可用、已使用、已过期、已回收
- 主按钮：
  - 可用态：`去使用`
  - 已使用态：`查看订单`
  - 已失效态：`查看原因`

### 2.3 首期交互建议

首期不建议把卡券页做得太重，优先保证 4 个关键动作：

1. 用户能看到自己现在有哪些可用卡券
2. 用户能知道哪些卡券快过期
3. 用户能从卡券页跳到商城去使用
4. 用户能看懂一张卡券为什么不可用

建议首期不要做：

- 复杂筛选器
- 券种聚合视图
- 太多运营活动 Banner
- 卡券转赠或分享

## 3. 卡券与商城的联动方式

当前商城链路已经支持“券即结算资产”，所以 `卡券` 页和商城的关系应设计成：

- 钱包是资产总览
- 商城是资产使用场景

建议联动动作如下：

### 3.1 从卡券页进入商城

卡券卡片点击 `去使用` 后：

- 若是全站券，跳商城首页并带上卡券上下文
- 若是分类券，跳对应分类列表
- 若是商品券，优先跳对应商品详情或购买弹层

### 3.2 商城弹层直接承接卡券

保持现有商品购买弹层中的卡券选择逻辑，并把文案从“我的可用优惠”进一步收口成“我的卡券”。

建议保留：

- 系统推荐最佳券
- 保留暗码输入
- 解释不可用原因

建议新增：

- 若用户从钱包卡券页带着某张券进入商城，则默认预选该券
- 如果该券当前商品不可用，要明确提示是“商品不适用 / 数量不适用 / 已过期”

### 3.3 公开领券继续放在商城场景内

公开券的“领取动作”可以继续主要发生在商城和活动页，而不是都堆到钱包里。

建议规则：

- 钱包 `卡券` 页以“我已拥有”为主
- 商城商品页以“我现在还能领什么”为主

这样用户不会把“已拥有资产”和“活动待领取”混在一起。

## 4. 后台能力对应的联动触发点

基于当前系统，最值得优先接入的联动分为 5 类。

### 4.1 充值联动

这是最值得优先做的联动。

建议首批玩法：

- 首充发券：首次充值成功后发一张新客首单券
- 满额发券：单笔充值达到指定档位后发高客单券
- 充值后召回券：充值成功后发“48 小时内可用”的限时券

价值：

- 提高充值后的二次消费转化
- 把“钱包有钱”转成“商城去花”
- 相比直接多送余额，成本边界更可控

建议发券参数：

- `source_channel`: `wallet_recharge`
- `audience_segment`: `first_recharge` / `high_value_recharge`
- `campaign_tag`: `recharge_boost`

### 4.2 推广联动

推广中心天然适合接卡券。

建议首批玩法：

- 邀请成功发被邀请人新客券
- 被邀请人首充后，邀请人得奖励券
- 被邀请人首购后，邀请人得高价值复购券

价值：

- 被邀请人更容易完成首单
- 邀请人的奖励不只停留在积分，可直接引导继续消费
- 能把“注册 -> 首充 -> 首购”旅程和卡券结合起来

建议发券参数：

- `source_channel`: `affiliate`
- `audience_segment`: `invitee_new_user` / `inviter_core`
- `campaign_tag`: `affiliate_growth`

### 4.3 签到联动

签到适合发轻量、短有效期的卡券。

建议首批玩法：

- 连签 3 天发小额券
- 连签 7 天发品类券
- 连签 14 天发高门槛券

价值：

- 把“签到行为”从纯补贴变成消费承接
- 提高商城回访频率
- 很适合做快过期券，刺激使用

建议发券参数：

- `source_channel`: `checkin`
- `audience_segment`: `retention_active`
- `campaign_tag`: `checkin_retention`

### 4.4 用户运营联动

这是后台现成能力最强的一块。

当前已经支持：

- 单用户发券
- 批量用户发券
- 按用户标签发券

建议首批玩法：

- 新用户未下单 3 天发首单券
- 高价值用户沉默 7 天发召回券
- 售后补偿发定向券
- 针对 `vip` / `创作者` / `流失风险` 标签发专属券

价值：

- 直接对应客服补偿、召回、分层运营
- 不需要额外发明新系统
- 可以立刻落到运营动作里

### 4.5 风控与售后联动

这块更偏“资产保护”，但也很关键。

建议规则：

- 风控异常时自动停券，避免公开券被刷
- 风险恢复后按恢复策略自动恢复
- 退款成功时自动返还资产券
- 客服补偿券和活动券分开标记，避免统计混淆

价值：

- 让卡券规模放大后仍可控
- 售后体验更稳定
- 后台能区分“营销成本”和“服务补偿成本”

## 5. 优先级排序

如果只做一轮迭代，建议优先级按下面顺序：

1. `钱包卡券页`
2. `充值发券`
3. `推广发券`
4. `签到发券`
5. `运营标签发券`

原因：

- `钱包卡券页` 是用户认知入口，没有它，资产感知很弱
- `充值发券` 最直接影响收入转化
- `推广发券` 最容易放大拉新效率
- `签到发券` 更偏留存增强，可放在后一位
- `标签发券` 虽然后台现成，但更适合在用户侧入口稳定后放大

## 6. 用户侧接口补口建议

为了把 `卡券` 页真正做起来，建议新增独立接口：

### 6.1 `POST /api/shop/my-discount-assets`

用途：

- 按用户维度拉取卡券资产，而不是按商品维度试算

建议返回：

- `summary`
  - `available_count`
  - `expiring_soon_count`
  - `used_count`
  - `expired_count`
  - `saved_amount_total`
- `available_assets`
- `used_assets`
- `inactive_assets`

每张资产建议返回字段：

- `asset_id`
- `discount_id`
- `code`
- `discount_type`
- `discount_value`
- `scope_type`
- `scope_category`
- `scope_product_id`
- `expires_at`
- `asset_status`
- `source_channel`
- `campaign_tag`
- `audience_segment`
- `last_order_id`
- `pricing_apply_stage`
- `is_exclusive`
- `stack_priority`

### 6.2 `POST /api/shop/recommend-discount-target`

用途：

- 根据卡券返回更合理的跳转目标

建议返回：

- `target_type`: `shop_home` / `category` / `product`
- `target_value`
- `target_label`

如果首期不想加这个接口，也可以先在前端按已有字段做简单跳转策略。

## 7. 页面文案建议

### 7.1 用户侧统一术语

用户侧统一使用：

- 主入口：`卡券`
- 集合概念：`我的卡券`
- 操作文案：`去使用` / `已使用` / `已失效`

避免用户侧出现：

- `卡券包`
- `优惠资产`
- `券码资产`

这些更像后台术语，不适合放在钱包一级导航。

### 7.2 后台术语

后台仍可以保留：

- `公开领券`
- `定向发券`
- `通用暗码`
- `卡券资产`

也就是说：

- 用户侧讲“卡券”
- 后台讲“发券模式 / 资产模型 / 活动配置”

## 8. 首期上线范围建议

建议首期只做下面这些：

1. 钱包左侧新增 `卡券`
2. 卡券页展示 `可用 / 已使用 / 已失效`
3. 卡券页支持查看有效期、来源、适用范围
4. 卡券页支持 `去使用`
5. 充值成功后发一类测试券
6. 推广成功后发一类测试券

建议暂缓：

- 卡券领取中心独立页
- 卡券复杂筛选
- 多活动聚合 Banner
- 卡券分享赠送
- 卡券与兑换码在用户侧完全统一展示

## 9. 开发顺序建议

建议按下面顺序推进：

1. 新增用户侧 `my-discount-assets` 接口
2. 钱包左侧加 `卡券` 导航与卡券页骨架
3. 接入卡券列表与状态分组
4. 打通卡券页跳商城的简单跳转
5. 接入充值成功发券
6. 接入推广成功发券
7. 复用后台详情页做首期数据复盘

## 10. 结论

这套卡券能力最适合的方向，不是把钱包做成“又一个活动页”，而是把它做成用户资产面板：

- `余额` 负责“我有多少钱”
- `卡券` 负责“我有哪些可省的钱”
- `商城` 负责“我去哪里把这些资产花掉”

如果只选一个最小闭环，建议先做：

- 钱包 `卡券` 页
- 充值发券
- 商城承接使用

这样就能先跑通“充值 -> 得券 -> 下单使用 -> 退款返券 -> 后台复盘”的完整链路。
