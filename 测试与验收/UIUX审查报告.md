# 湖财人平台 · UI/UX 审查报告（微信小程序）

> **被测版本**：`feature` 分支 @ `5395d59`
> **范围**：uni-app（Vue3）客户端 51 个页面 + 15 个公共组件，微信小程序为主、兼顾 H5
> **方法**：只读代码审查 + 静态量化统计；**无真机、无浏览器渲染**，所有结论均可按 `file:line` 复核
> **日期**：2026-09-21　**审查人**：朱荆林
> **未改动任何文件、未提交**

---

## 一、结论摘要（按优先级）

| # | 结论 | 级别 |
| --- | --- | --- |
| 1 | **HEAD 提交把 8 个页面的手机端字号/布局修正整段注释掉了**（`5395d59` 注释掉 `05f8660` 刚加的 `@media (max-width:767px)` 块）→ 手机端字号中位从 **14px 掉到 11px**，最小 **6px** | **P0** |
| 2 | **字号体系整体偏小**：全仓 1529 条 `font-size` 中 **760 条（50%）折算不到 12px**，441 条不到 10px；共 **87 种取值**，没有类型阶梯 | **P0** |
| 3 | **键盘策略缺失**：全仓 `cursor-spacing` 与 `:adjust-position` **各 0 次** → 小程序里表单被键盘遮挡是系统性的 | **P0** |
| 4 | **三层设计令牌全是死的**：`uni.scss` 8 个变量 **0 引用**且没有 SFC 用 `lang="scss"`（sass 也没装）；`--hufe-*` 只在 `App.vue` 内消费 8 次；**1194 个硬编码色值** | **P1** |
| 5 | **对比度系统性不达标**：元信息灰 `#8b95a4` 在白底 3.03:1、页面底 2.80:1、卡片灰 2.65:1；金色 `#e1c58d` 仅 1.46–1.67:1 | **P1** |
| 6 | **可点元素缺按压反馈**：`hover-class` 在动态行/卡片上几乎全缺；311 个 `<button>` 仅 39 个带 `:loading` | **P1** |
| 7 | **小程序专项**：无分包（主包 1571 KB / 2048 KB）；`<image lazy-load>` **全仓 0 次** | **P2** |
| 8 | **触控热区普遍不足 88rpx**：首页主 CTA 32px、通知按钮 33px、筛选 chip 38px、轮播控制 28×30px、`.section-more` 42px、多处 tab 33px | **P0** |
| 9 | **状态语义缺失**：`jobs` 有 `loading` 却从未渲染（首屏必显「没有岗位」）；`benefits` 过期权益仍给可点蓝色主按钮；`feedback` 历史徽标恒绿；`mine` 用 `—` 同时表示未登录与无数据 | **P0** |
| 10 | **组织页相册全链路无懒加载 + 原图直出 + `no-store`**；`chapters` 全量加载全量渲染（`pageSize:100` + while 拉满） | **P0** |

> **覆盖面**：全局层 + 51 个页面分 6 组全部审完（`file:line` 级证据与改法见 §三）。页面级问题合计 **130 余条**，其中**高 24 条、中 60 余条**。

---

## 二、全局层（跨页面，已逐条实测）

### 2.1 【P0】手机端字号与布局修正被 HEAD 提交注释掉

这是本轮**最需要先确认**的一件事。git 历史显示：

| 提交 | 动作 | 规模 |
| --- | --- | --- |
| `05f8660` style: 补齐首页、服务和实名表单的手机布局 | **新增** 8 个页面的 `@media screen and (max-width: 767px)` 块（手机字号 + 布局修正） | **+218 行** |
| `5395d59` style: 注释各页面移动端媒体查询样式,覆盖提交 ← **当前 HEAD** | **把上面那 8 个块整段 `/* */` 注释掉** | 8 文件、+16/−16 |

**受影响的 8 个页面**（`source/pages/*/index.vue`）：`directory`、`events`、`home`、`manual-verification`、`mine`、`profile`、`register`、`services`。

**实测影响**（注释掉的是 ≥12px 的 px 覆盖值，当前生效的是 rpx 基础层）：

| 页面 | 当前生效字号（中位 / 最小） | 被注释掉的覆盖值（中位 / 最小） |
| --- | --- | --- |
| directory | 10.5px / **8.0px** | 14px / 12px |
| events | 10.5px / **8.5px** | 14px / 12px |
| home | 12.5px / **6.0px** | 14px / 12px |
| manual-verification | 10.0px / **7.5px** | 14px / 12px |
| mine | 13.0px / **6.0px** | 14px / 12px |
| register | 10.0px / **8.0px** | 14px / 12px |
| services | 13.0px / **6.5px** | 14px / 12px |
| **合计** | 274 条，中位 **11.0px**，最小 6.0px | **123 条，中位 14px，最小 12px，全部 ≥12px** |

> **换算口径**：微信小程序规定屏幕宽 = 750rpx，在 375px 逻辑宽的机型上 **1rpx = 0.5px**。故 `17rpx = 8.5px`。
>
> **建议**：先与提交者确认这是有意为之还是误提交。若是误提交，`git revert 5395d59` 即可让手机端字号回到 12–28px 区间；若是有意，需要另一套等价的手机端字号方案，否则手机端正文将长期处于 8–11px。

### 2.2 【P1】三层设计令牌全部失效

| 层 | 定义处 | 消费情况 | 结论 |
| --- | --- | --- | --- |
| SCSS 变量 | `source/uni.scss` 8 个 `$uni-*` | pages/components 引用 **0 次**；**0 个 SFC 使用 `lang="scss"`**；`sass`/`sass-embedded` 未安装 | 连编译机会都没有，纯死代码 |
| JS 主题 | `source/config/index.js` `theme` | `appConfig.theme` 消费 **0 次** | 死配置 |
| CSS 自定义属性 | `source/App.vue` `--hufe-page-gutter` / `--hufe-content-bottom` / `--hufe-tabbar-height` / `--hufe-safe-bottom` / `--hufe-content-max` | **只在 App.vue 内部消费 8 次**，页面与组件 **0 次** | 未起到令牌作用 |

**后果**：`community/index.vue:86` 的悬浮按钮硬编码 `bottom: 92px`，而权威值就在 `--hufe-tabbar-height: 58px`；`ChatThread.vue:75`、`ConversationList.vue:89` 直接写裸 `env()`。

**建议**：短期把 `--hufe-*` 提到 `:root` 级并在页面消费；或直接删除 `uni.scss` 以免交付方误以为主题体系存在。**不要**在没有引入 sass 的情况下继续维护 `$uni-*`。

### 2.3 【P0】字号与单位

| 指标 | 实测 |
| --- | --- |
| 生效 `font-size` 声明总数 | **1529 条** |
| 折算后 < 12px | **760 条（50%）** |
| 折算后 < 10px | **441 条** |
| 最小 | **6.0px**（`12rpx`） |
| 不同字号取值 | **87 种** |
| 单位 | rpx **4498** 处 vs px **2239** 处（媒体查询内 1093） |

**字号 Top（同一语义混用两种单位）**：`18rpx×155`、`14px×136`、`17rpx×114`、`16px×103`、`12px×98`、`20rpx×92`、`21rpx×88`。

**建议**：建立三档类型阶梯并全仓收敛 —— 辅助 **24rpx(12px)**、正文 **28rpx(14px)**、标题 **32–36rpx(16–18px)**；小程序端统一用 rpx，H5 端媒体查询内用 px。

### 2.4 【P1】颜色与对比度

**色值规模**：hex 出现 **2216 次**、**1194 个不同色值**；`#033481` 168 次、`#fff` 159 次；同一个白色有 `#fff` / `#FFF` / `#FFFFFF` 三种写法，**同色不同大小写共 51 组**。

**对比度实测**（WCAG AA 正文需 ≥4.5:1）：

| 前景色 | 白底 | 页面底 `#F4F6FA` | 卡片灰 `#edf0f4` |
| --- | --- | --- | --- |
| `#033481` 主色 | 11.59 ✅ | 10.71 ✅ | 10.14 ✅ |
| `#27354a` 正文 | 12.39 ✅ | 11.46 ✅ | 10.84 ✅ |
| `#176551` 绿 | 6.96 ✅ | 6.43 ✅ | 6.09 ✅ |
| `#7D8798` tabBar 未选中 | 3.63 ⚠️ | 3.35 ⚠️ | 3.17 ⚠️ |
| `#8b95a4` 元信息灰 | **3.03 ⚠️** | **2.80 ❌** | **2.65 ❌** |
| `#e1c58d` 金 | **1.67 ❌** | **1.54 ❌** | **1.46 ❌** |

**建议**：元信息灰统一提到 `#5F6B7E`（白底 5.9:1）；金色仅用于装饰，若作文本须换 `#6B5A3E` 一类深金。

### 2.5 安全区与视口

- `env(safe-area-inset-*)` 只在 **7 个文件**出现（`chapters`、`community`、`sso-webview`、`BusinessDetailSheet`、`ChatThread`、`ConversationList`、`App.vue`），51 个页面里绝大多数没有处理底部安全区。
- `constant(safe-area-*)` 兜底 **0 处** —— 不支持 `env()` 的 UA 上，**整条 `padding` 简写声明会被丢弃**（不只是 inset 部分）。
- `100vh` 5 处（小程序里 `vh` 不含 tabBar 与安全区）。

**建议**：统一的底部留白写法：
```css
padding-bottom: 12px;
padding-bottom: calc(12px + constant(safe-area-inset-bottom));
padding-bottom: calc(12px + env(safe-area-inset-bottom));
```

### 2.6 交互反馈与状态覆盖

| 指标 | 实测 | 判断 |
| --- | --- | --- |
| `<button>` 总数 / 带 `:disabled` / 带 `:loading` | 311 / 139 / **39** | 仅 13% 有进行中反馈 |
| `uni.showLoading` | **1 次**（全站） | 全局加载指示几乎不用 |
| `uni.showModal` | 107 次 | 弹窗较多，注意弹窗疲劳 |
| `uni.showToast` | 83 次 | 空 title 调用 0 次（好） |
| `hover-class`（行/卡片按压反馈） | 动态行、会话行、消息卡、资讯卡**全缺** | 微信端 `view` 默认零反馈 |
| `aria-*` / `role=` | 仅在少数页面 | 读屏支持薄弱 |

**状态覆盖**（按页面文件统计，已排除委托给共享组件的 `chapter-*`）：

- 无「空态」字样：**22 / 51**（其中 `chapter-*` 6 页委托 `ChapterPage.vue`，该组件三态齐全，不算缺口）
- 无「错误/重试」：**9 / 51**
- 无「加载中」：**13 / 51**

**建议**：把「加载中 / 空 / 错误+重试」三态抽成公共组件（`ChapterPage.vue`、`ConversationList.vue`、`CommunityHighlights.vue` 已各自实现一遍，可提取为 `<HufeState>`）。

### 2.7 微信小程序专项

| 项 | 实测 | 建议 |
| --- | --- | --- |
| 主包体积 | **1571 KB / 2048 KB（余量 23%）**，51 页全在主包，无 `subPackages` | 尽快分包；品牌图三件占 351 KB |
| `<image lazy-load>` | **全仓 0 次** | 官网资讯、组织相册、企业 Logo 等远程图应加 |
| `v-for` 总数 / 带 slice 裁剪 | 123 / **7** | 长列表整表渲染，需触底加载 |
| `<textarea>` 总数 / `auto-height` / `:adjust-position` / `cursor-spacing` | 26 / **1** / **0** / **0** | 见 §2.3 与各分组 |
| `<scroll-view>` / 带 `enhanced` 或 `show-scrollbar` | 19 / 14 | 尚可 |
| `tabBar.height` | `58px`，图标 5/5 齐全，配色 `#7D8798` / `#033481` / `#FFFFFF` | 正常 |
| 导航标题 | 51 页全部设置；`pages/conversations/index` 与 `pages/chat/index` **标题都是「对话」** | 建议区分（例：消息 / 会话） |
| 构建 | `build:mp-weixin` 成功，315 文件 / 1571 KB | 正常 |

---

## 三、页面级问题

> 分组审查，逐条给 `file:line` 与可执行改法。已由我抽样复核的条目在「复核」列标注。

### 3.1 主导航与首屏（home / services / mine / ecosystem / about）

> 前提更正：`CommunityHighlights.vue` **首页并未使用**，全仓仅 `pages/community/index.vue:4` 引用。本组全部页面用原生导航，无 `navigationStyle:"custom"`。

| 页面 | 问题 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| home | 首屏主 CTA「登录湖财人 / 进入湖财服务」高 64rpx = **32px** < 88rpx；`App.vue` 的移动端 44px 兜底只覆盖 `.primary/.secondary/.ghost-button`，不含 `.hero-action` | **高** | `home/index.vue:22,213`；`App.vue:328-338` | `.hero-action{min-height:88rpx;height:auto;line-height:1.4}`，并并入 App.vue 兜底选择器 |
| home | 微字号系统性不可读：38 条 rpx 字号里 **26 条 <24rpx**；最差 `.welcome-meta` 17rpx(8.5px)、`.notice-button>view` 12rpx(**6px**)、`.task-item__hint` 15rpx(7.5px) | **高**（复核） | `home/index.vue:213` | 说明文字统一 ≥24rpx；角标 ≥20rpx |
| home | `@media (max-width:360px)` 把字号**再砍一刀并隐藏信息**：`.task-item__hint{display:none}`（5 个入口失去说明文案） | **高** | `home/index.vue:216` | 删除该块中的字号与 `display:none` 声明，只保留 padding 收缩 |
| home | `.notice-button` 66rpx = **33px**（<88rpx），角标 `right:-9rpx;top:-9rpx` 溢出到卡片描边外且仅 12rpx 字 | **高** | `home/index.vue:11,213` | 按钮 88rpx；角标 `min-width:30rpx;height:30rpx;font-size:20rpx`；补 `aria-role="button" aria-label="消息中心，N 条未读"` |
| home | **首屏闪现「官网同步服务暂不可用」**：`contentOffline` 初值 `true` 且 `newsItems:[]`，请求未回来就渲染离线空态 | **高** | `home/index.vue:85,50,58,130-143` | 加 `contentLoading`，加载中显示骨架；仅 catch 后才置 `contentOffline=true` |
| home | 离线状态**两条近似文案上下叠且互相矛盾**（状态行 + 空态），且「请稍后下拉刷新」不是可发现的操作 | 中 | `home/index.vue:50,58,111-114` | 离线时隐藏状态行，只留一条空态 + 可点「重新加载」 |
| home | 下拉刷新**恒弹「已刷新」**，即使资讯请求失败、页面仍在显示离线横幅 | 中 | `home/index.vue:119` | 按结果给不同 toast |
| home | 全页 **0 处按压反馈**：`.task-item` / `.ecosystem-entry` / `.news-item` / `.section-more` 全是裸 `<view @tap>` | 中 | `home/index.vue:31,37,44,49,52` | App.vue 定义 `.tap-active{opacity:.82}`，全组统一挂 `hover-class` |
| home | 「查看全部 ›」热区仅 ~**21px** 高 | 中 | `home/index.vue:44,49`；`App.vue:146-151` | `App.vue .section-more{min-height:88rpx;display:flex;align-items:center}` |
| home | 次级文字对比度全部低于 3.6:1：`#9aa2af`=2.57、`#8992a0`=3.14、`#8b95a4`=3.03、`#7d899a`=3.55（且字号 ≤21rpx） | 中 | `home/index.vue:213` | 统一次级灰 `#5A6474` |
| home | hero 文案来自后端（`heroConfig`）无长度约束，而 `.campus-mark` 绝对定位 `right:34rpx;bottom:38rpx`、`.hero-copy{width:68%}` → 长副标题会重叠 | 中 | `home/index.vue:20-25,213` | `.hero-desc{-webkit-line-clamp:3}`；`.campus-mark` 移入文档流或给 hero 加 `padding-bottom:150rpx` |
| home | 品牌字标是 SVG 且内嵌 base64 JPEG，微信 `image` 对 SVG 渲染不一致；`image` 未纳入 App.vue 的 box-sizing 重置 | 中 | `home/index.vue:5,213`；`App.vue:72-82`；`server/src/brand.js:9` | 首屏字标改用 `wordmarkUrl`（JPG）或导出 PNG@3x |
| services | 微字号：26 条 rpx 字号里 **20 条 <24rpx**；最差 `.task-chip view text:last-child` 14rpx(**7px**)、`.service-hero__brand text` 15rpx | **高**（复核） | `services/index.vue:221` | 说明/描述 ≥24rpx |
| services | 搜索区一处三问题：容器 84rpx=42px；`⌕`(U+2315) **Android 常见缺字形显示为 □**，且点它不会聚焦输入框；清除键热区仅 ~29px | **高** | `services/index.vue:17-21,221` | 容器 ≥88rpx；整个搜索框 `@tap` 聚焦；`⌕` 换图标；清除键 ≥88rpx |
| services | `:disabled` **无任何视觉态**：`.primary-button[disabled]` 与可用态同形，「进入服务」禁用后用户不知为何点不动 | 中 | `services/index.vue:63`；`App.vue:165-169` | 补 `.primary-button[disabled]{opacity:.45;box-shadow:none}` |
| services | 6 个 `.task-chip`（主筛选器）高 76rpx = **38px** < 88rpx，40rpx 图标 + 两行文字硬塞在 76rpx 内 | 中 | `services/index.vue:25-28,221` | `min-height:88rpx;height:auto`，文字行 24rpx |
| services | 负边距叠层与同组其它页不一致，卡片比 hero 内缩：`margin:-18rpx 18rpx 0` 叠加 `.service-tools{margin-top:-18rpx}` | 中 | `services/index.vue:221,225`；`App.vue:100` | 统一用 `var(--hufe-page-gutter)` |
| services | 同一个 `.section-more` 承担两种语义：home/mine 是可点链接，services 是静态计数「21 项」，字号颜色完全相同 → 视觉误导 | 中 | `services/index.vue:35`；`home/index.vue:44`；`mine/index.vue:17` | services 改用独立 `.section-count` |
| services | 描述最长 70 字且无行数限制（18rpx），两列网格卡片高度参差 | 中 | `services/index.vue:194,221` | `-webkit-line-clamp:2` + `maxLength:44` |
| mine | 微字号：23 条里 **15 条 <24rpx**；`.workbench-card__head>text` 15rpx、`.progress-entry__icon>text` 12rpx(**6px**) | **高**（复核） | `mine/index.vue:200` | 角标 ≥20rpx、说明 ≥24rpx |
| mine | 「**—**」同时用于「未登录」和「数据未到」：登录后首帧 4 张工作台卡片全显 `—`，看起来像数据错误 | **高** | `mine/index.vue:19-24,150-152,160-163` | 拆三态：未登录→「登录后查看」；加载中→骨架；无数据→`0` |
| mine | 三个高危操作挤在同一 `.utility-list`；`.utility-item` 86rpx=43px < 88rpx；「注销平台账号」仅靠 1rpx divider 与普通项分隔 | 中 | `mine/index.vue:57-61,200` | `.utility-item{min-height:96rpx}`；注销项独立卡片 + 警示图标 |
| mine | 身份说明被硬截断：`.profile-meta` nowrap + ellipsis，而第二行常是长文案（如实名待复核原因） | 中 | `mine/index.vue:9-10,200,115` | 第二条加 `.profile-meta--desc{white-space:normal;-webkit-line-clamp:2}` |
| ecosystem | 微字号最严重：20 条里 **15 条 <24rpx（75%）**；`.ecosystem-card__top>text` 14rpx(**7px**) | **高**（复核） | `ecosystem/index.vue:149` | 英文标签 ≥18rpx 或删除；正文 ≥24rpx |
| ecosystem | 同一「未知数据」两种占位：hero 用 `—`，卡片用「数据待获取」 | 中 | `ecosystem/index.vue:117,122` | 统一为 `—`（与 home/mine 一致） |
| ecosystem | 卡片未做 flex 列布局，`__desc{min-height:83rpx}` 只能兜 2 行 → 同行两卡的「进入 ›」不在同一水平线 | 中 | `ecosystem/index.vue:149` | `.ecosystem-card{display:flex;flex-direction:column}` + `__foot{margin-top:auto}` |
| ecosystem | `.ecosystem-principle{margin:-16rpx 18rpx 0}` 与 hero 内绝对定位的 `.ecosystem-hero__stats{bottom:30rpx}` 几乎相撞 | 中 | `ecosystem/index.vue:149,15-18` | stats `bottom:44rpx`，或 hero 加 `padding-bottom:120rpx` |
| about | 微字号：23 条里 15 条 <24rpx，**主操作按钮 `.about-action{font-size:21rpx}`(10.5px)** | **高** | `about/index.vue:114-117` | `.about-action{font-size:26rpx}`；legal/eyebrow ≥20rpx |
| about | 4 个 `.about-action` 用固定 `height:88rpx;line-height:88rpx`，App.vue 的 `height:auto` 兜底不含它 → 文案换行或微信字体放大时文字溢出 | 中 | `about/index.vue:117,48-51`；`App.vue:84-91,328-338` | `min-height:88rpx;height:auto;padding:16rpx 18rpx;line-height:1.35` |
| about | 折叠面板唯一状态指示是 `#adb4be`(**2.09:1**) 的 `›`；缺 `aria-expanded`（微信用 `aria-role`/`aria-expanded`） | 中 | `about/index.vue:34-44,116` | 箭头改 `#52627D`；展开态加背景 + `aria-expanded` |
| SupportFooter | 版权文字 18rpx(9px) + `#929CAA`=**2.78:1** | 中 | `SupportFooter.vue:24-36,45-52` | 色统一 `#5F6B7C`，字号 24rpx |
| SupportFooter | 断点有 **32px 空档**：`min-width:800px` 与 `max-width:767px` 之间（768–799px，含 iPad 竖屏）两条都不命中，回落 18rpx | 低 | `SupportFooter.vue:38,45` | 改 `min-width:768px` |
| CommunityHighlights | 控制按钮 `‹ ›` **28×30px**、空态重试 ~32px 高，热区严重不足 | **高** | `CommunityHighlights.vue:101,102` | `min-width:88rpx;min-height:88rpx`（视觉尺寸可保持，用 padding 撑） |
| CommunityHighlights | **整个组件是 px 体系**（56 处 px、0 处 rpx），与本组其它页脱节：大屏不缩放、小屏字号锁死 11px | 中 | `CommunityHighlights.vue:96-103` | 改 rpx；`height:173px` → `min-height:346rpx` |
| CommunityHighlights | `swiper` 固定 `height:173px` + 标题 `max-height:54px` 硬裁两行；微信字体放大时会被切 | 中 | `CommunityHighlights.vue:98,100,103` | 固定高度改 `min-height`，`max-height` 交给 line-clamp |
| 全组 | **触控热区 <88rpx 清单**：`.hero-action` 64、`.notice-button` 66、`.task-chip` 76、`.utility-item` 86、`.workbench-card__head` 50、`.section-more` ~42px、轮播控制 28×30px | **高** | 各页 style 行 + `App.vue:146-151` | App.vue 增全局 `.tap-target{min-height:88rpx;display:flex;align-items:center}` 并逐项套用 |
| 全组 | **固定 `height` 承载文字** 8 处：微信「设置-通用-字体大小」放大后溢出 | 中 | `home:213`、`services:221`、`mine:200`、`about:117`、`CommunityHighlights:98,100` | 一律 `min-height` + `height:auto` + `line-height:1.35` |
| 全组 | tabBar 高度假设与微信端不符：`pages.json:70-73` 的 `height:"58px"`/`fontSize:"11px"`/`iconWidth` **仅 App 与 H5 生效**（微信小程序原生 tabBar 基线 50px + 安全区） | 中 | `pages.json:65-73`；`App.vue:61,105-107` | ① 接受微信基线 → token 改 50px；② 必须 58px → 改自定义 tabBar（`"custom": true`）。另 `color:"#7D8798"`=3.63:1 在 10–11px 下不达标，建议 `#5F6B7C` |
| 全组 | 同语义 tone 色值 **4 套并存**：blue `#e6edf8/#e7eef9/#e8eef8`；gold `#8b682e/#846129/#82602a`；green `#e4f2ed/#e5f2ed/#e4f1ec`；red `#964644/#974a46/#97443f` | 低 | `home:213`、`services:221`、`mine:200`、`ecosystem:149`、`about:114` | App.vue 定义 8 个 tone 变量，7 个文件各删 5 条硬编码 |
| 全组 | 灰色次级文字 **12 个近似色值**（全部 2.0–3.6:1） | 低 | 同上级页面 style 行 | 合并为 `#5A6474`（≥6:1）与 `#6B7686`（≥4.8:1）两档 |
| 全组 | 次级说明字号 **7 档**：14 / 15 / 17 / 18 / 19 / 20 / 21rpx | 低 | 各页 style 行 | 收敛为「正文 28 / 说明 24 / 辅助 20rpx」 |
| 全组 | 顶部留白 4 档、叠层负边距 3 档、卡片内边距 5 档、圆角 7 档 | 低 | `App.vue:100,112,156` + 各页 | 抽 `--hufe-page-top` / `--hufe-overlap` / `--hufe-card-padding` / 3 档圆角 |
| 全组 | 「找/办/联/学/享」五分类在 home 与 services **命名不同**（home「找校友/联资源」vs services「找资源/联机会」），且 services 多一个「全部」 | 低 | `home/index.vue:88-92`；`services/index.vue:83-87` | 定一份常量表 |
| 全组 | 字符图标跨端字形风险：`⌕`(U+2315，Android 缺字形风险最高)、`◉`(U+25C9) 等，无一处用 SVG/uni-icons | 低 | `services/index.vue:18`；`EventCard.vue:10` | `⌕`→`🔍` 或 iconfont；引入一组 SVG 图标 |
| 全组 ✅ | **正向范例**：`CommunityHighlights` 的 `:disabled="opening"` + 文案切「正在打开…」、空态区分 loading/error/无数据并给「重新加载」 | — | `CommunityHighlights.vue:4-23,66-90` | 建议抽成公共 `<AsyncState>` 复用 |

### 3.2 活动 / 返校 / 日程 / 公益（events / event-detail / campus-visit / calendar / giving / giving-certificate）

| 页面 | 问题 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| event-detail | 报名/取消**无 in-flight 锁与 loading**，确认后 `await` 期间主按钮仍可点，可重复发起请求 | **高** | `event-detail/index.vue:61`、`:220-265` | 加 `submitting`；按钮 `:loading="submitting" :disabled="actionDisabled \|\| submitting"`；方法首行短路，`finally` 复位（仓库已有范式 `chapter-publish/index.vue:169`） |
| campus-visit | 键盘遮挡：`textarea` 是最后字段，其下紧跟「提交返校预约」，键盘弹起后被完全盖住 | **高**（复核） | `campus-visit/index.vue:54,57,61` | `textarea` 加 `:adjust-position="true" cursor-spacing="120"`；或提交按钮改 `App.vue:278` 的 `.sticky-action` 底栏 |
| campus-visit | 字数计数绝对定位 `bottom:34rpx`，与 150rpx 的 textarea 纵向重叠约 20rpx，**压住最后一行字** | **高** | `campus-visit/index.vue:57-58,194` | textarea 加 `auto-height` + `min-height:150rpx`；计数改到框下方普通流 |
| campus-visit | 「已有预约」判定只排除 `cancelled`，而列表把 `rejected/completed/closed` 视为已失效 → **被驳回后无法改约同日期时段** | **高** | `campus-visit/index.vue:145` vs `:71,74` | 抽 `isActiveStatus()` 两处复用 |
| calendar | 最小字号 **13–16rpx（6.5–8px）**；≤360px 断点还把 `.date-status` 压到 13rpx | **高**（复核） | `calendar/index.vue:363,365` | 辅助文字下限 20rpx、正文 ≥22rpx；删掉 13rpx 那条 |
| calendar | 「查看来源 ›」是 16rpx 纯文本、无 padding，点按高度≈10px，却是全页唯一来源核验入口 | **高** | `calendar/index.vue:109,363` | 改块级 `min-height:88rpx`，或整条 footer 可点 |
| giving | 记录状态徽标**恒绿**：`已取消` / `未通过确认` 也显示成功色 | **高** | `giving/index.vue:97,641-649` | `:class` 按状态给三色 tone |
| giving | 「匿名」是自定义 view 开关 **74×40rpx = 37×20px**，热区严重不足，且无 role/aria、无文字标签 | **高** | `giving/index.vue:72-74,522-548` | 改用原生 `<switch>`（同 `post-editor/index.vue:8`），或 `min-height:88rpx` + `role="switch"` |
| giving-certificate | 证书内辅助字号 **12–17rpx（6–8.5px）**，而这是要截图留存的凭证 | **高**（复核） | `giving-certificate/index.vue:296` | 辅助 ≥20rpx、字段值 ≥22rpx、正文 ≥24rpx |
| events | `onPullDownRefresh` 已实现但 `pages.json` 未开 `enablePullDownRefresh` → 下拉刷新是死代码 | 中 | `events/index.vue:104`；`pages.json:21` | 补开；或加 88rpx 刷新按钮 |
| events | 筛选 chip 高 64rpx = **32px** < 88rpx，且无按压反馈 | 中 | `events/index.vue:27-36,164` | `height:88rpx` + `hover-class` |
| events | 错误/空态按钮被本地 `height:72rpx`(36px) 覆盖，低于全局 88rpx | 中 | `events/index.vue:175` vs `App.vue:155` | 删本地高度 |
| events | 对比度：`#A0A7B2/#F4F6FA = 2.24:1`、`#8C95A4 = 2.79:1`、金色日期卡 `#6E4E21/#D4AE68 = 3.62:1` | 中 | `events/index.vue:169-170,176`；`EventCard.vue:52,57` | 元信息统一 ≥`#5C6A80` |
| event-detail | `status-badge--joined` 与 `--closed` 可同时命中，后者覆盖 → 已报名用户在活动结束后看到灰色「已报名」 | 中 | `event-detail/index.vue:25,293-294` | 用单一 tone |
| event-detail | `.detail-date` 用 `backdrop-filter: blur()`，微信 Android WebView 不支持 | 低 | `event-detail/index.vue:278` | 去掉，改半透明底 |
| campus-visit | 触控热区：取消按钮 64×24px、stepper 27px、slot-item 33px | 中 | `campus-visit/index.vue:193-196` | 统一 ≥88rpx |
| campus-visit | placeholder 色 `#AFB5BF` 在 `#F6F8FA` 上仅 **1.94:1** | 中 | `campus-visit/index.vue:54,57`；`App.vue:274` | 提到 `#8C93A0` |
| campus-visit | 日期格式一页三套：`2026-02-14` / `2026-02-14 · 09:00–11:00` / 「2月14日」 | 低 | `campus-visit/index.vue:31,72-73,178-181` | 统一「2026年2月14日 · 09:00–11:00」 |
| giving | 金额 chip 按 33.333% 排成 3+2，第二行右侧留空；chip 高 34px | 中 | `giving/index.vue:62-67,452-465` | 改 2 列 + 「自定义」整行 |
| giving | 微信原生 `button[disabled]` 优先级高于 `.primary-button`，禁用态会盖掉渐变外观 | 中 | `giving/index.vue:76-77`；`App.vue:165-169` | 补 `.intent-submit[disabled]{...}` |
| giving-certificate | 微信端只有「复制证书编号」，无保存/分享证书图片入口 | 中 | `giving-certificate/index.vue:84-92` | 加 `canvasToTempFilePath` + `saveImageToPhotosAlbum` |

### 3.3 组织 / 名录 / 地图（chapters + chapter-\* / directory / alumni-map）

> `chapter-detail/about/contact/members/album/messages` 六个是 13 行的包装页，样式与逻辑全在 `components/ChapterPage.vue`。

| 页面 | 问题 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| chapter-members | **成员搜索最少 2 字，但输入框无提示、无校验**：输入单个汉字（中文最常见姓氏，如「张」）后端直接返回空数组，前端落到「没有找到相关成员」→ 用户以为组织里没这个人 | **高**（复核） | `server/src/business/service.js:2758`（`if (query.length < 2) return { items: [] }`）；`ChapterPage.vue:81`（`maxlength="120"`，无 minlength/提示）；`:96-97`（空态文案） | 前端在 1 个字时直接提示「至少输入 2 个字再搜索」不发请求；空态文案改「未找到含“张”的成员，试试完整姓名或学院」 |
| directory / alumni-map / chapter-manager / chapter-publish | 这 4 个 use-rpx 页面**零 `:focus-visible`**，可点元素无 `role`/`aria-label`：alumni-map 9 个 `@tap` 对 7 个 `<button>`、directory 6 对 3、chapter-publish 7 对 5 | **高** | `alumni-map/index.vue:16,41`；`directory/index.vue:18,25,29,40`；`chapter-publish/index.vue:28,32`；对照 `chapters/index.vue:288`、`ChapterPage.vue:740` 都有 `:focus-visible` | 可点元素改 `<button>` 或补 `role="button" tabindex="0"`；tab 补 `aria-pressed`；各页补 `button:focus-visible{outline:3px solid #b8914d}` |
| directory | **hero 内容溢出压字**：标题 40rpx 约 2 行 + 21rpx 描述 + `bottom:28rpx` 绝对定位的隐私条；内容高约 434rpx > `min-height:310rpx`，hero 被撑高而隐私条仍贴 `bottom:28rpx`，直接压到描述上 | **高** | `directory/index.vue:156,162,163,164` | 隐私条去掉 `position:absolute` 走文档流；或 `min-height` 提到 520rpx。被注释的 `202-227` 行里已写好正确写法 |
| chapters | **组织全量加载 + 全量渲染**：`while` 循环按 `pageSize:100` 拉完全部页，模板对 `filteredChapters` 直接 `v-for`，无 `slice`、无 `onReachBottom` | **高**（复核） | `chapters/index.vue:174-178`（while 拉全部页）、`:62-84`（全量 `v-for`） | `pageSize` 降到 20 + `onReachBottom` 追加；至少加渲染窗口 `slice(0, renderLimit)` |
| ChapterPage / OrganizationAlbums | **相册与封面 `<image>` 无 `lazy-load`，且原图直出、接口 `cache-control: private, no-store`** → 进入相册即拉 12 张照片 + 12 张封面原图，且每次重进都重新下载 | **高**（复核） | `OrganizationAlbums.vue:29,38,42`；`services/organizationAlbums.js:5`（`pageSize=12`）；`server/src/app.js:955`（`private, no-store`，无缩略图参数） | ①所有 `<image>` 补 `lazy-load`；②服务端支持 `?w=320` 缩略图，网格用缩略图、`previewImage` 才用原图；③`no-store` 换 `private, max-age=86400` + ETag |
| ChapterPage / OrganizationAlbums | 相册、成员、留言三块**无单次渲染上限**：分页累加后全部保留在 DOM（`photos = [...photos, ...items]`） | 中 | `OrganizationAlbums.vue:82,28`；`ChapterPage.vue:86,118` | 加渲染窗口 `slice(0, renderLimit)`；已有正确范式 `OrganizationAlbums.vue:42` 的 `legacyPhotos.slice(0, legacyLimit)` |
| ChapterPage | **「精修像素」与「rpx 缩放」两套体系混写**：移动端 `.section-title` 被压到 20rpx（**10px**，比 App.vue 全局 34rpx 小 41%），桌面端又抬到 22px（比全局 18px 大 22%）；主按钮与「分享」按钮不同高（76/80rpx vs 88rpx） | 中 | `ChapterPage.vue:742,681,705,700-701`；对照 `App.vue:131`（全局 34rpx）、`App.vue:312`（全局 18px） | 二者择一；先修 `.section-title`（出现在主页、成员、相册、留言 4 处） |
| chapter-members | 成员头像一直是首字母色块，且 `slice(0,1)` **只取 1 字**，而组织卡/管理员台取 2 字；目录页取**尾** 2 字（`slice(-2)`）→ 同名首字全部撞脸 | 中 | `ChapterPage.vue:87` vs `:285`；`chapters/index.vue:196`；`directory/index.vue:128`；`server/src/business/service.js:2740` | 统一 2 字且统一取尾（与后端 `slice(-2)` 一致） |
| ChapterPage | 相册区在**小程序端拿不到父作用域样式**：父组件写了 `.chapter-album{padding:20px;border-radius:18px}` 与 `.chapter-album__grid/__photo`，子组件根类名是 `.organization-albums`，且 `__grid/__photo` 在组件内根本不存在（真实类名 `.album-photo-grid`）→ 这批规则只在 H5 生效 | 中 | `ChapterPage.vue:711,731-733,707`；`OrganizationAlbums.vue:136` | 删掉 `.chapter-album*` 整组死选择器；内边距由 `OrganizationAlbums` 自己声明或父级用 `:deep()` |
| 全组 9 页 | `enablePullDownRefresh` 与实现不匹配：`directory`/`alumni-map`/`chapter-publish` 未开启，而 `alumni-map:96` 实现了 `onPullDownRefresh` → **永不触发的死代码** | 中 | `pages.json:32,41,31`；`alumni-map/index.vue:96`；对照 `pages.json:23-30` 其余页已开启 | directory / alumni-map 补开；chapter-publish 保持关闭但删掉死代码 |
| chapter-publish | `type="number"` 在小程序拉起带符号键盘；`<label>` 包裹 input **但没有 `for`/`id` 配对**，点标签不聚焦；必填校验失败只弹 toast，不定位不标红 | 中 | `chapter-publish/index.vue:84,48-52,56-60,82-86,621-623` | 改 `type="digit"`；补 `for`/`id`；错误改字段级 + `uni.pageScrollTo` 定位 |
| chapter-manager | 组织切换 chip 首字母徽标 `14rpx`（≈7px）不可读；chip 是 `<view @tap>`，无 `role`/`aria-pressed` | 中 | `chapter-manager/index.vue:639-650,18-23`；对照 `chapters/index.vue:19-25` 已用 `<button>` + `aria-pressed` | 字号提到 18rpx；chip 改 `<button>` + `aria-pressed` |
| directory | 空态有标题+描述+按钮，加载态只有一行裸文本「正在读取校友名录…」，错误态同样裸文本 → 三态不成体系 | 中 | `directory/index.vue:11,12,13`；`App.vue:225-242` | 加载/错误态补 `empty-state__icon` 与 `__title/__desc` |
| directory | 校友卡标签行**溢出卡片**：`.alumni-tags` 无 `flex-wrap`、子项无 `overflow-wrap`，长「行业 + 城市」在窄屏顶出卡片 | 中 | `directory/index.vue:184,188,189-190`；正确写法在 `:218-222` 的**注释块**里 | 取消注释并转 rpx：`flex-wrap:wrap` + `overflow-wrap:anywhere` |
| chapter-contact | 联系方式值 `max-width:68%` 硬限宽 + 右对齐，长邮箱/地址被压成窄条多行 | 低 | `ChapterPage.vue:678,743` | 放宽到 72% 并允许换行，或改「标签在上、值在下」 |
| chapter-publish / chapter-manager | 辅助说明文字 `15–19rpx`（7.5–9.5px）几乎不可读 | 低 | `chapter-publish/index.vue:743`；`chapter-manager/index.vue:798-800,845-851` | 全组辅助说明下限统一到 20rpx |
| ChapterPage | 成员/留言/相册的「查看更多」按钮在 loading/error 时**直接消失**，无文案替代 → 三处布局位移不一致 | 低 | `ChapterPage.vue:101,131`；`OrganizationAlbums.vue:34,40,35,41` | 按钮保留 + `:disabled` + 文案「加载中…」 |
| ChapterPage | 卡片圆角同页三档：`App.vue .surface` 28rpx(14px)、`chapter-album/__members/__messages` 18px、`overview-card` 18px、`chapters .card` 16px | 低 | `ChapterPage.vue:711,741`；`App.vue:112`；`chapters/index.vue:262` | 抽一档应用到本组全部卡片 |
| alumni-map | 小程序端文案「拖动 · 缩放」与实际能力不符（MP 无 iframe，只有「在浏览器打开」按钮） | 低 | `alumni-map/index.vue:13,17-20,21-23` | 用条件编译分平台给文案 |
| 全组 | 顶部间距各自为政：directory 12rpx / alumni-map·chapter-manager·chapter-publish·ChapterPage 14rpx / chapters `20px` | 低 | 各页 style 行 | 统一 `--hufe-page-top`；`chapters` 的 20px 与 `--hufe-page-gutter:28rpx` 也不一致，需单独确认 |

**本组 Top 3**

1. **成员搜索单字静默失效**（`service.js:2758` + `ChapterPage.vue:81`）：中文姓氏单字搜索是最常见路径，当前 100% 落到「没有找到相关成员」。改法成本极低。
2. **相册全链路无懒加载 + 原图直出 + `no-store`**（`OrganizationAlbums.vue:29/38/42`、`organizationAlbums.js:5`、`app.js:955`）：唯一会同时打满流量与内存的问题。
3. **`chapters` 全量加载全量渲染**（`chapters/index.vue:174-178,62-84`）：无 `onReachBottom`、无裁剪、`pageSize` 直接开到 100。

**本组一致性观察（具体数值）**

- **同一语义四套字号**：组织 hero 主标题 `ChapterPage` 36rpx vs `chapter-manager` 39rpx vs `chapter-publish` 40rpx vs `chapters` 26/32/36px（断点）。
- **卡片圆角三档并存**：14px（`.surface`）/ 16px（`chapters`）/ 18px（`ChapterPage`）。
- **断点集合本组就有 4 套**：`chapters` 600/1024/1440；`ChapterPage` 600/768/1024/1200(+480)；`chapter-manager`/`chapter-publish` 768/1200；`alumni-map` **0 个断点**。且 `ChapterPage` 在 600/1024 切换栅格列数、章节网格却在 768/1200 切换 → 跨断点同一行内模块列数错位。
- **单位混用落在同一文件同一区块**：`ChapterPage.vue` 678 行 rpx、679-703 行 px、705-752 行 px、753-765 行又回 rpx。
- **触控目标**：`scope-chip` 31px、`organization-chip` 36px、`record-action` 29px、`.album-danger` ~33px；本组唯一达标的只有 `chapters`（44px）。
- **可点元素实现两套**：`chapters`/`ChapterPage` 几乎全 `<button role tabindex aria-label>`；`alumni-map`/`chapter-publish`/`directory` 用 `<view>`/`<text>` 承载点击。
- **`v-for` 裁剪率 ~15%**：13 个 `v-for` 仅 2 处裁剪，且裁的是最不关键的「历史照片」，照片网格与成员网格两个最重列表均未裁剪。

### 3.4 社区 / 消息 / 资讯（community / community-comments / post-editor / conversations / chat / inbox / official-news / news-detail）

| 页面 | 问题 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| community | 首屏要等 `loadAllPages` 拉完全部分页才渲染第一张卡，期间只有一行「…正在读取校友动态」 | **高** | `community/index.vue:53`；`utils/pagination.js:6-18` | 先渲染第 1 页再后台续拉；加载时渲染骨架卡 |
| CommunityPostBody | 未登录（无 token）时 `load()` 直接 return，**9 个格子永久停在「图片加载中…」** | **高** | `CommunityPostBody.vue:33,9` | 无 token 时置 `error:true` 并显示「登录后查看图片」 |
| CommunityPostBody | 正文 2000 字全量铺开，无截断、无「展开」 | **高** | `CommunityPostBody.vue:3,48`；`post-editor/index.vue:10` | `-webkit-line-clamp:6` + 「展开全文」 |
| post-editor | 字数计数与「发布到湖财圈」都在 textarea 下方，230px 输入框 + 键盘把两者推出屏幕 | **高**（复核） | `post-editor/index.vue:10,11,32,130` | 计数移入框内右上；发布按钮改 `.sticky-action` 底栏 |
| post-editor | 输入 `@` 弹出的人员面板 DOM 在 textarea **下方**，键盘顶起后整块在屏幕外 | **高** | `post-editor/index.vue:91,23-29,10-11` | 面板改底部抽屉 `position:fixed;bottom:0`，或先 `uni.hideKeyboard()` |
| community-comments | 键盘遮挡：输入框下方是匿名开关行与「提交评论」，键盘弹起后两者被覆盖 | **高** | `community-comments/index.vue:9,10,11,114` | textarea 加 `cursor-spacing="24" :adjust-position="true"`；提交行移到上方或做 fixed 底栏 |
| ChatThread | `.chat-composer` 常驻 safe-area 内边距，键盘弹起后输入框离键盘约 **46px** 空档 | **高** | `ChatThread.vue:75`；`pages.json`（`pages/chat/index` `disableScroll:true`） | `onKeyboardHeightChange` 切 class：键盘可见时 `padding-bottom:12px` |
| ChatThread | 5 秒轮询 + 有新消息就无条件滚到底，**用户上翻看历史会被反复拽回底部** | **高** | `ChatThread.vue:44,48,4` | 仅当距底部 <80px 才 `scroll()`；否则显示「n 条新消息 ↓」浮标 |
| official-news | 拉取失败被折成「空」：`useOfflineFallback()` 丢掉 `error.message`，且**没有重试按钮** | **高** | `official-news/index.vue:32,73-83` | 拆三态，错误态透出原文 + 「重新加载」 |
| news-detail | **正文两条渲染路径字号不一致**：`rich-text` 内联 `p{font-size:16px}`，回退路径 `.article-paragraph` 是 25rpx ≈ **12.5px** | **高**（复核） | `news-detail/index.vue:21,22,160`；`services/richText.js:2` | 统一 32rpx / 行高 1.9 |
| inbox | **字号整体塌陷**：时间戳 16rpx≈8px、摘要 19rpx≈9.5px、详情正文 23rpx≈11.5px | **高**（复核） | `inbox/index.vue:240,241` | 时间戳/标签 24rpx、摘要 28rpx、正文 30rpx |
| CommunityPostBody | 单张失败点「重试」会 `clear()` 重建整组，已成功的图全部闪回加载中并重新下载 | 中 | `CommunityPostBody.vue:9,29-32` | 新增 `retryOne(index)` 只重载该格 |
| CommunityPostBody | 图片串行换票，9 张 = 9 次往返 | 中 | `CommunityPostBody.vue:34-40` | 并发上限 3 的批次 |
| CommunityHighlights | 轮播高度写死 173px，长标题被 `overflow:hidden` 切掉 | 中 | `CommunityHighlights.vue:98,100,103` | `min-height:173px;height:auto` + `line-clamp:3` |
| community-comments | 每条评论一张独立白卡，20 条=20 张卡，层级噪音大 | 中 | `community-comments/index.vue:14,114` | 改「一张卡 + 分割行」 |
| community-comments / ConversationList / ChatThread | 时间格式三套：ISO 截断、`toLocale*`（**无 NaN 兜底，iOS 微信会显示 `Invalid Date`**） | 中 | `community-comments:47`；`ConversationList.vue:44`；`ChatThread.vue:44` | 抽 `utils/time.js` 的 `relativeTime()` |
| ConversationList | 会话时间只显示「8/12」，今天也无时分；跨年会误导 | 中 | `ConversationList.vue:6,44` | 同上 |
| ConversationList | 群聊预览无发送者前缀；已解散的群仍可点进对话 | 中 | `ConversationList.vue:6` | 加 `senderName：text`；`dissolved` 去掉 `@tap` |
| ConversationList | 会话行是裸 `<view @tap>`，无 `hover-class`，点列表毫无触感 | 中 | `ConversationList.vue:3,6` | `App.vue` 加全局 `.hufe-row--active` 并统一挂 `hover-class` |
| post-editor | 图片删除按钮 30×30px，且与预览点击区重叠，易误触删图 | 中 | `post-editor/index.vue:13,130` | 命中区扩到 44×44px 或加二次确认 |
| inbox | 已读/未读标题字重完全相同（都 700），读完只有 5rpx 金条变化 | 中 | `inbox/index.vue:240,28,29` | 已读降 `font-weight:400` + `opacity:.82` |
| inbox | 消息中心无日期分组，只有 5 个筛选 chip | 中 | `inbox/index.vue:27-36,155` | 按日期分组 + 吸顶标签 |
| official-news | 卡片图写死 `height:260rpx` + `aspectFill`，官网原图被大面积裁切；无 `@error` 兜底 | 中 | `official-news/index.vue:22,99` | 用比例盒 `padding-top:56.25%` + `@error` |
| news-detail | 加载失败同时弹 modal **并渲染一篇伪造的「文章」**，页面内无重试按钮 | 中 | `news-detail/index.vue:99,100,42-45` | 改页面级错误态 + 重新加载 |
| ChatThread | 无日期分隔线，每条消息重复 `senderName · 月日 时:分` | 中 | `ChatThread.vue:6,44` | 同人 5 分钟内合并 byline；跨天插日期分隔 |
| ChatThread | 发送失败提示在页面**最顶部**，键盘弹起时完全在屏幕外 | 中 | `ChatThread.vue:3,75,53` | 发送类错误改 toast 或 composer 上方内联 |
| ChatThread | 图片消息先渲染成文件行、链接到手再换图 → 布局跳动 | 中 | `ChatThread.vue:6,50` | 固定比例占位框 |

### 3.5 权益 / 导师 / 企业 / 岗位 / 合作 / 志愿 / 课堂 / 反馈

| 页面 | 问题 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| jobs | `loading` 声明且被维护，**模板引用 0 次** → 首屏与刷新直接落入「没有匹配的在招岗位」；加载失败只 toast，随后同样显示空态。**本组唯一没有加载态与错误态的列表页** | **高** | `jobs/index.vue:72,93-101`；模板 `:12-21` 内 `loading` 出现 0 次 | 补 `v-if="loading && !jobs.length"` 加载态与 `error` 卡片（照抄 `benefits/index.vue:29-30`） |
| benefits | 领取按钮**无「未开始 / 已过期」态**：`endAt` 只参与文案拼接，既不过滤也不禁用 → 过期权益仍显示可点的蓝色「实名领取」，点下去才被服务端拒 | **高** | `benefits/index.vue:86,127-132,205-216`（`:211` 是 `endAt` 唯一出现处） | 增 `benefitState()`（未开始/可领取/已领完/已过期），label + disabled + 色板三态；可复用 `event-detail/index.vue:104` 的 badge 模式 |
| enterprise-owner | 49KB 认证表单**无分节、无锚点**（10 字段 + 材料上传连成一片），且**提交按钮不吸底**（在表单末尾）→ 长表单要滚两三屏才够到主操作；同组其余三个编辑页都吸底 | **高** | `enterprise-owner/index.vue:2`（root 无 `with-sticky-action`）、`:27-89,86,145`；对照 `collaboration-editor/index.vue:2,77`、`mentor-profile:2,126`、`enterprise-job-editor:2,97` | 拆「主体信息 / 联系与简介 / 证明材料」三节；提交改 `sticky-action` |
| mentor-profile | 上限 12000 字的「导师简介」固定 300rpx(150px) 高、**无 `auto-height`**，长文写作极难 | **高** | `mentor-profile/index.vue:108,382` | `auto-height` + `min-height:300rpx` + `max-height:600rpx` |
| feedback | 提交按钮 <5 字时置灰 + `opacity:.48`，但页面**从不显示「至少 5 个字」**；`submit()` 里的 5 字 toast 因按钮 `disabled` 而**不可达（死代码）** | **高** | `feedback/index.vue:13,45,56-59,77` | 计数区显示「还需 N 字」，或按钮保持可点 + toast 原因 |
| benefits / academy | 列表封面图 `aspectFill` + **无 `lazy-load`**，而数据经 `loadAllPages` 全量加载 → 进页即拉全部封面 | **高**（性能） | `benefits/index.vue:33,173,312`；`academy/index.vue:18,39,90` | 列表图 `:lazy-load="true"`；目录改分页而非全量渲染 |
| benefits | 名额耗尽无状态：`quotaText` 只显示「限 N 份 · 已领取 M」，不比较 M≥N，按钮仍可点 | 中 | `benefits/index.vue:217-222,86` | `claimed >= quota` 时禁用并显示「已领完」 |
| mentors | `pageSize:100` 静默截断，页头还写「{{ mentors.length }} 位」，无「加载更多」 | 中 | `mentors/index.vue:83,16` | 改 `loadAllPages` 或显式显示总数 |
| mentors | 卡片两按钮固定 128/168rpx 宽、**66rpx(33px)** 高、**20rpx(10px)** 字 | 中 | `mentors/index.vue:23,139-141` | 高度 ≥88rpx、字号 ≥24rpx |
| mentors | 「已提交申请」仍是蓝底可点（只弹 toast），与 benefits 置灰已领取不一致 | 中 | `mentors/index.vue:23,91-94,141` | `disabled` + 「已提交申请，查看详情」 |
| mentor-profile | 最少 20 字校验只在 toast；**本页没有「* 必填」图例**（同组另 3 个表单页都有） | 中 | `mentor-profile/index.vue:108,322,80-107,381`；对照 `collaboration-editor:19`、`enterprise-owner:27`、`enterprise-job-editor:28` | 统一 `.section-head` 右侧「* 必填」图例；placeholder 写「至少 20 个字」 |
| mentor-profile | 2 个 textarea 均 `show-confirm-bar="false"`、无 `cursor-spacing`/`adjust-position`/`@confirm` | 中 | `mentor-profile/index.vue:108,113` | 开 confirm-bar 或加 `:adjust-position` + `cursor-spacing` |
| enterprises | Logo 76rpx×76rpx + `aspectFill`，非方形组合标被裁切 | 中 | `enterprises/index.vue:26,141` | 改 `aspectFit` + 白底内边距 |
| enterprises | 简介截到 100 字却**无行数 clamp**，卡片高度不可控 | 中 | `enterprises/index.vue:31,104,146`；对照 `feedback/index.vue:77` 已用 clamp | 加 2 行 `-webkit-line-clamp` |
| enterprises | 详情主按钮「访问企业官网」在无 `website` 时**永久置灰且无说明** | 中 | `enterprises/index.vue:57` | 无官网时隐藏按钮 + 正文说明 |
| enterprise-owner | 同名字段「企业简介」**三套上限**：认证表单 1200、资料表单 12000、服务端 3000 | 中 | `enterprise-owner/index.vue:65-66` vs `:140-141` | 提常量 `SUMMARY_MAX=3000` 两处共用 |
| enterprise-owner | 3000/12000 字简介固定 250rpx(125px)、无 `auto-height` | 中 | `enterprise-owner/index.vue:140,763` | `auto-height` + min/max-height |
| enterprise-owner | 材料「移除」是 16rpx(8px) 绝对定位文本，点击区约 16px；营业执照预览 `aspectFill` 会裁切证件 | 中 | `SecureMaterialPicker.vue:13,65`（本页 `:73-78` 引用） | 移除改 ≥44rpx 图标按钮；预览改 `aspectFit` |
| enterprise-owner | 材料数量自相矛盾：`maximum` 传 `4 - serverMaterials.length`，组件 hint 仍写死「最多 4 张」 | 中 | `enterprise-owner/index.vue:75` vs `SecureMaterialPicker.vue:33` | hint 动态化「还可上传 N 张」 |
| enterprise-owner | 「显示/隐藏」统一社会信用代码是 18rpx 纯文本、触控区约 18×12px；认证状态卡「刷新状态」按钮 75×30px、17rpx | 中 | `enterprise-owner/index.vue:43,767,95,775` | 均提到 ≥44rpx 高；刷新按钮 ≥88rpx/≥24rpx |
| enterprise-job-editor | 两段 12000 字 textarea 固定 265rpx、投递说明 190rpx，无 `auto-height` | 中 | `enterprise-job-editor/index.vue:77,82,87,433-434` | `auto-height` + min/max-height |
| jobs | 列表按钮 70rpx(**35px**) 高、22rpx(11px) 字 | 中 | `jobs/index.vue:18,160-162` | ≥88rpx / ≥24rpx |
| collaboration | 「撤回审核」不可逆，却与「我知道了」**同权重同宽度**且就在详情吸底条里 | 中 | `collaboration/index.vue:54-58,209` | 下移并弱化，或二次确认 + 危险色 |
| collaboration | 分段 tab 高 65rpx(**33px**)、计数徽标 30rpx(15px) | 中 | `collaboration/index.vue:11-14,175` | tab 高 ≥88rpx |
| collaboration-editor | 12000 字详情用**位置选择器** `.field-block--textarea:nth-child(2)` 抬到 380rpx → 字段顺序一变就错位 | 中 | `collaboration-editor/index.vue:59,275-276` | 改具名类 |
| collaboration-editor | 「联系说明」前端 `maxlength=1000`、计数 /1000，**服务端上限 200** | 中 | `collaboration-editor/index.vue:64-65` | 改 200 |
| collaboration-editor | 合作摘要**三套数字**：placeholder「建议 30–150 字」、`maxlength=300`、校验最少 20 | 中 | `collaboration-editor/index.vue:54,55,200` | 统一「20–300 字」 |
| collaboration-editor | `<label>` 包住 `RegionPicker`（内部渲染 `<button>`）→ 微信 label 会自动激活第一个表单组件，点「选择」可能触发两次 `begin()` 并重置 trail | 中 | `collaboration-editor/index.vue:34-38`；`RegionPicker.vue:3,30` | 外层改 `<view>` |
| collaboration-editor | 键盘弹起时吸底操作条被顶到键盘下方，正文最后一行被遮挡；3 个 textarea 关 confirm-bar、无 `cursor-spacing` | 中 | `collaboration-editor/index.vue:2,54,59,64,77-80`；`App.vue:290` | 聚焦时隐藏吸底条或加 `cursor-spacing` |
| volunteer | 「服务项目」是只读文本、无 ›、无「去选择」入口，且**默认自动选中第 1 个项目** → 用户可能不知道投了哪个 | 中 | `volunteer/index.vue:40,98,102-105` | 未显式选择时显示「请先在上方选择项目」 |
| volunteer | 已申请后主按钮只变绿但仍可点，点击只弹 toast | 中 | `volunteer/index.vue:45,157,113-116` | `disabled` 或改「查看我的申请」 |
| volunteer | 「联系电话」必填但无 `*`、placeholder 也未说明 | 中 | `volunteer/index.vue:42,117-119` | 补必填标记 + 「11 位手机号」 |
| volunteer | 「协助内容」被 `nowrap` + ellipsis 强制单行截断（内容最长 120 字，几乎必然被截） | 中 | `volunteer/index.vue:15,152-153` | 改 2 行 clamp |
| academy | 课程封面 100%×260rpx（≈335×130）`aspectFill`，16:9/4:3 被大幅裁切 | 中 | `academy/index.vue:18,139,148` | 16:9 容器 + `aspectFill` 或 `aspectFit` |
| academy | 详情主按钮「打开课程内容」无 `contentUrl` 时永久置灰且无说明 | 中 | `academy/index.vue:47` | 隐藏按钮 + 「课程内容待发布」 |
| feedback | 建议正文 textarea **无 label、无必填标记**，与下方「联系方式」有 label 不一致 | 中 | `feedback/index.vue:10` vs `:11` | 加「建议内容 *」label |
| feedback | 勾选「匿名提交」后联系方式框 `disabled` 但**仍显示已填号码**，提交时实际清空 → 界面与真实提交不一致 | 中 | `feedback/index.vue:11,12,61` | 勾选即清空 + 「匿名提交不发送联系方式」 |
| feedback | 历史状态徽标**颜色固定绿**，「待受理/已关闭」与「已回复」同色 | 中 | `feedback/index.vue:18,77` | 按 status 分色 |
| feedback | 历史加载失败被静默吞掉（catch 后置空数组），无错误态 | 中 | `feedback/index.vue:50-52` | 加 `historyError` + 重试 |
| 全组 | 触控高度低于 44px：`.filter-chip` 29px、`.tab-switch view` 33px、`.mentor-action` 33px、`.job-card__actions button` 35px、`.owner-job__actions button` 32px、`.certification-status button` 30px、`.sensitive-input>text` 18rpx、`.secure-material>text:last-child` 16rpx | 中 | 各页 style 行 | 统一 ≥88rpx |
| 全组 | **4 页共 7 个「万字级」textarea** 用 250–380rpx 固定高、无 `auto-height`；12 个 textarea 里 11 个关 confirm-bar；全组 `adjust-position`/`cursor-spacing` = 0 | 中 | `enterprise-owner:763`、`collaboration-editor:275-276`、`mentor-profile:382`、`enterprise-job-editor:433-434` | 统一 `auto-height` + min/max-height + 键盘策略 |
| 低 | 其余打磨项：mentors 卡片固定挂「审核发布」徽标造成噪音；主题/标签 `v-for` 无 `slice`+「+N」（mentors/jobs/collaboration）；jobs `{{ job.city }}` 无「城市待定」兜底；jobs 无下拉刷新；benefits 已领取与可领取同色；benefits 我的记录固定 `pageSize:100`；volunteer 选中态过弱、hero 固定高；academy 印章 13rpx(6.5px)；feedback 评分默认 5 分无「未评分」态、历史固定 3 条无入口、时间只显示 MM.DD；mentor-profile 可选字段无「（选填）」 | 低 | 各页 style 行 | 按一致性方案统一 |

**本组 Top 3**

1. **jobs 无加载态/错误态**（`jobs/index.vue:72,93-101`）：`loading` 声明了但模板 0 引用 → 首次进入必然显示「没有匹配的在招岗位」，把网络等待与加载失败都渲染成「没有岗位」。
2. **benefits 领取按钮缺「未开始 / 已过期 / 已领完」三态**（`benefits/index.vue:86,127-132,209-222`）：过期权益仍给蓝色可点主按钮。
3. **大表单可写性 + 键盘/吸底**：`enterprise-owner`（无分节无吸底）、`collaboration-editor`（吸底条遮挡）、`mentor-profile`、`enterprise-job-editor` —— 4 页 7 个万字级 textarea 固定高、无 `auto-height`。

**本组一致性观察（数值）**

- **重复实现**：`.search-box` 被 5 页各写一份（height 84/86/88/84/84rpx，input 字号 23/23/24/23/23rpx）；`.filter-chip` 高度都 58rpx，但圆角 19/19/18/19/19、字号 21/21/22/21/21、左右内边距 22/22/24/22/22。
- **表单字段体系 4 套**：`.owner-field`（label 23rpx / input 70rpx / textarea 250rpx）、`.form-field`（23/70/265rpx）、`.field-block`（23/72/270→380rpx）、`.field-block`（23/72/300rpx）。
- **字号**：本组 361 次 `font-size`、**42 种取值**（rpx 343 / px 18）；元信息最小 16–18rpx（8–9px），而 `App.vue:340-349` 在 ≤767px 把 `.form-label/.form-control` 定为 14px → **同一屏内 9px 与 14px 并存**。
- **颜色**：本组 **269 个不同 6 位 HEX**（606 次使用）；按通道差 ≤10 聚类得 **41 组近似色** —— 浅分隔线一组 21 个值（`#edf0f4`×21、`#e9eef5`×9、`#edf1f5`×9…），灰字一组 16 个值，危险红一组 10 个值，主色 `#033481`×64 之外还有 7 个近似深蓝。
- **空态/错误态覆盖**：8 页有 `.empty-state`；`jobs` 无 loading/error（唯一）；`feedback` 历史失败静默空；`mentors`/`volunteer` 无「加载更多/总数」。

### 3.6 账号与身份（profile / verify / register / change-password / manual-verification / sso-webview / card / gate / account-conflict）

| 页面 | 问题 | 级别 | 证据 | 建议 |
| --- | --- | --- | --- | --- |
| register | **分步进度条状态错误**：`stepIndex` 在「设置账号」阶段返回 1，使第 2 步被渲染成已完成，第 3 步永不被点亮 | **高** | `register/index.vue:9,130,347` | `stepIndex` 返回 2；`.step--active` 拆成 done/current 两态 |
| register | 三个密码/用户名框无 `cursor-spacing`，「确认平台密码」在表单最底部，键盘弹起必被遮挡 | **高**（复核） | `register/index.vue:74-76` | `cursor-spacing="30"`；确认框确保按钮有 ≥40rpx 上边距 |
| manual-verification | 材料上传提示「每张不超过 500MB」，与真实分片路径（>2MB 走分片）严重不符 | **高** | `manual-verification/index.vue:99`；`services/privateMaterials.js:2,111-115` | 展示改「单张 ≤5MB，建议 2MB 以内」 |
| manual-verification | 10 个输入 + 1 个 textarea 全部无 `cursor-spacing`，textarea 无 `auto-height` | **高**（复核） | `manual-verification/index.vue:87-96,519` | 输入 `cursor-spacing="24"`；textarea `cursor-spacing="40" auto-height` |
| manual-verification | 材料「移除」标签 15rpx（≈5px）文字，触控面积不达标易误删，且无二次确认 | **高** | `manual-verification/index.vue:65,111,530` | `min-width:88rpx;min-height:48rpx` + 二次确认 |
| card | 核验码倒计时**只显示「N 秒后更新」（5 秒刷新周期）**，真实的 10 秒有效期从不显示；`remaining` 已算出但模板未用 | **中**（复核） | `card/index.vue:34,88,28`；`server/src/gate/service.js:76-80` | 改「本码 N 秒后失效 · M 秒后自动换新」，把 `remaining` 显示出来 |
| card | 二维码显示尺寸 360rpx（375 屏 180px / 320 屏 153.6px），而 `createDataURL(6,24)` 自然尺寸 246px → 被下采样，模块间距仅约 **3.7–4.4 CSS px**，余量很小 | **中**（复核） | `card/index.vue:32,161`；`utils/gateQr.js:12` | 提到 520rpx（窄屏 600rpx）并把 `cellSize` 6→4；**须真机实测扫码** |
| card | 票据失效/签发失败后可能「无码可刷也无按钮可点」（`canIssue=false` 时刷新按钮永久禁用） | 中 | `card/index.vue:33,38,124,135` | 空态分层 + 始终保留一次手动重试 |
| card | 学工号占位文案「暂未提供完整学工号」直接当卡面编号展示 | 中 | `card/index.vue:21,99-102` | 无号时展示 `— — —`，说明放卡下方 |
| gate | 粘贴核验码用 `<textarea>`（130rpx 多行），换行/空格会带入 token，且它是「备用入口」却占最大视觉权重 | 中 | `gate/index.vue:16,80` | 改 `<input>` + `confirm-type="done"`；`inspect` 前 `.replace(/\s+/g,'')` |
| gate | 「核验说明（必填）」textarea 无 `auto-height`/`cursor-spacing`，下方紧跟两个决策按钮 | **高** | `gate/index.vue:21` | `cursor-spacing="40" auto-height`；容器 `min-height:160rpx` |
| gate | `error`/`notice` 渲染在页面**最顶部**，而出错动作在中部/底部 | 中 | `gate/index.vue:4,22` | 改 `position:sticky` 或内联到操作区旁 |
| gate | 扫码→核对→确认后的收尾弱：确认成功只清预览 + 顶部一条 notice，不提示「下一位」 | 中 | `gate/index.vue:66,22,4` | 结果条带「已放行 · 继续扫下一位 / 完成」 |
| verify | 密码「显示/隐藏」开关点击区仅约 26px；输入框字号 24rpx = 12px（iOS 聚焦会放大） | 高 / 中 | `verify/index.vue:38,182` | `.field-toggle{min-height:88rpx}`；输入态 `font-size:32rpx` |
| verify / register / manual-verification | 表单校验失败只用 toast，**字段级错误 0 处**（无 error 类、无 `aria-invalid`） | 中 | `verify/index.vue:129,155-158`；`register/index.vue:78` | 加 `fieldErrors` + `.field-box--error` + 框下红字 |
| change-password | 三个密码框**没有可见性开关**，与 verify/register 的「显示/隐藏」不一致 | 高 | `change-password/index.vue:11-13,102` | 新密码两框各加切换；统一抽 `HufeSecureInput` |
| change-password | 校验错误只在卡片底部一条，三个字段无就地提示 | 中 | `change-password/index.vue:16,69-70` | 按错误码映射到字段 |
| account-conflict | 危险操作二次确认齐备，但弹窗内**不显示将被注销的账号数量/名称** | **高** | `account-conflict/index.vue:67-84,41` | 弹窗写明影响面与保留项 |
| account-conflict | 页面无取消/返回出口（无 `onBackPress`，次级操作只有「注销全部并重新注册」） | 中 | `account-conflict/index.vue:35-37,52-57` | 加「稍后处理，返回登录」 |
| sso-webview | **错误页无任何出口**：只有一句「请返回注册页」，无返回/重试按钮，也无加载态 | **高** | `sso-webview/index.vue:4-8` | 加主按钮「返回注册页重试」+ `web-view` 加载占位 |
| profile | `bio` textarea 在卡片底部、无 `auto-height`、无 `cursor-spacing` | 高 | `profile/index.vue:12,43` | `cursor-spacing="40" auto-height` |
| profile | 联系电话与其余字段共用 `type="text"`，手机号不唤起数字键盘；`key.endsWith('Year')` 分支实际永不生效 | 中 | `profile/index.vue:12,26` | `fieldDefinitions` 增 `inputType` |
| profile | 小屏媒体查询整段被注释（`@media (max-width:600px)`） | 低 | `profile/index.vue:45-54` | 直接取消注释即可 |

---

## 四、修复优先级

**P0（影响可用性，建议上线前处理）**

1. 确认并处理 `5395d59` 注释掉的 8 个手机端样式块（§2.1）—— 这一条同时影响首页、服务、我的、注册、实名、名录、活动 7 个主路径。
2. 字号阶梯：全仓收敛到 24/28/32rpx 三档，优先处理 §2.3 里 <10px 的 441 条。
3. 键盘策略：全局约定 `cursor-spacing`（普通 24 / 贴底 40）+ `auto-height`，优先 `register`、`manual-verification`、`post-editor`、`community-comments`、`gate`、`campus-visit`、`profile` 七个表单页。
4. **触控热区统一 ≥88rpx**：首页主 CTA 只有 32px、通知按钮 33px、筛选 chip 38px、轮播控制 28×30px、`.section-more` 42px、`.utility-item` 43px、多处 tab 33px。
5. **`jobs` 补加载态与错误态**（`jobs/index.vue:72,93-101`）：`loading` 声明了但模板 0 引用，首次进入必然显示「没有匹配的在招岗位」。
6. **`benefits` 领取按钮补「未开始 / 已过期 / 已领完」三态**（`:86,127-132,209-222`）：过期权益仍给蓝色可点主按钮。
7. **组织页相册/封面全链路无懒加载 + 原图直出 + `no-store`**（`OrganizationAlbums.vue:29/38/42`、`organizationAlbums.js:5`、`app.js:955`）。
8. **`chapters` 全量加载全量渲染**（`:174-178,62-84`）：无 `onReachBottom`、无裁剪、`pageSize` 直接开到 100。

**P1（体验显著劣化）**

9. `hover-class` 全局按压反馈 + `:loading` 覆盖到所有提交类按钮（311 个 button 仅 39 个带 loading）。
10. 对比度：元信息灰提到 `#5F6B7E`，占位符提到 `#8C93A0`，金色换深金。
11. 三态组件化：加载/空/错误+重试抽成 `<HufeState>`（`jobs`/`official-news`/`feedback` 历史/`community` 均有缺失）。
12. 大表单可写性：`enterprise-owner` 加分节 + 吸底提交；四处万字级 textarea 加 `auto-height`。
13. `card` 核验码尺寸与倒计时文案（真机扫码验证）。
14. `CommunityPostBody` 未登录永久「加载中」与单图重试牵连全组。
15. `ChatThread` 上翻被拽回底部。
16. `register` 分步进度条状态错误；`member` 搜索单字静默无结果；`home` 首屏闪现离线态。

**P2（打磨）**

17. 分包 + `<image lazy-load>`（全仓 0 次）。
18. 时间格式统一 `utils/time.js`（同时修掉 iOS `Invalid Date`）。
19. `--hufe-*` 令牌落地或删除 `uni.scss`；色值大小写统一（51 组）；`#edf0f4` 一组就有 21 个近似值。
20. `pages/conversations/index` 与 `pages/chat/index` 区分导航标题。
21. 触控/表单/卡片的一致性收敛：4 套表单字段体系、5 份重复的 `.search-box`、7 档次级字号、7 档圆角。

---

## 五、方法与取证说明

- **统计口径**：rpx → px 按微信官方定义 `750rpx = 屏幕宽`，以 375px 逻辑宽折算 **1rpx = 0.5px**。
- **对比度**：WCAG 2.x 相对亮度公式实算，阈值取 AA（正文 4.5:1、大字 3:1）。
- **样式分析**：剔除 `/* */` 注释后按 `@media` 嵌套关系分层统计，基础层即手机默认生效的样式。
- **页面级结论**来自 6 组并行审查（`file:line` 级证据 + 改法），其中 §2 全局层、§2.1、§3.6 的 `card` 两条、以及标注「复核」的条目由我独立复算确认。
- **未做**：真机渲染、真机扫码、iOS/Android 差异实测、读屏实测。凡需真机确认的条目已在正文标注。
- 本轮**未修改任何文件、未提交**。
