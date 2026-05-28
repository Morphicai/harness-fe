# Blog images — 2026-05-28 Chrome DevTools vs Harness-FE

放 5 张图(blog 正文按顺序引用)。所有图片建议:

- 格式 PNG(截图)/ SVG(图表)
- 文件名严格按下表
- 暗色截图统一一套终端配色,浅色截图统一一套浏览器主题
- 关键元素用 Morphix 品牌蓝 `#005EFF` 做红框高亮

| 文件名 | 用途 | 建议尺寸 | 内容描述 |
|---|---|---|---|
| `01-user-report.png` | hero 上方 | 1200×600 | 用户群聊/客服截图。气泡内容:"我刚才好好的怎么又登出了??"。时间戳清晰。 |
| `02-devtools-application.png` | "用 DevTools 撞墙"段 | 1400×800 | Chrome DevTools → Application → Local Storage 视图。`auth_token` 那一行是空的,红框高亮 `(empty)` 状态。 |
| `03-agent-storage-tail.png` | "给 agent 装上眼睛"段 | 1600×900 | Claude Code 终端截图。左侧 user prompt "用户报告随机被踢出登录...";右侧 agent 调用 `storage_tail` 输出的 JSON,高亮 `initiator.stack` 那几行。深色终端配色。 |
| `04-time-comparison.png` | "90 秒"对比段 | 1400×500 | 两根横向时间条对比:<br/>1)"DevTools workflow" ~120 分钟,分段 "Application 看状态 / Sources 打断点 / 复现等待 / Monkey-patch / 还是没找到"<br/>2)"Harness-FE workflow" ~90 秒,分段 "storage_tail / read source / propose fix"<br/>Morphix 品牌蓝 `#005EFF` 做强调色。 |
| `05-network-source.png` | "不止是 storage" 案例 2 | 1600×800 | 左半屏 Claude Code `network_tail` 输出,显示 `POST /api/setting 404`。右半屏对应源码 `useSettings.ts:23` 高亮 `${API}/setting` 那一行,标注 "missing 's'"。 |

## 可选:社交分享卡片

`social-card.png` —— 1200×630,作为 og:image。文案建议:

> **Chrome DevTools 不好用?**
> 不妨试试 Harness-FE
>
> 90 秒找到 token 被删的元凶

Morphix 品牌色,大字标题,右下角放 logo。

## 当前状态:placehold.co 在线占位

博文当前所有 `<img>` 直接引用 `https://placehold.co/...` 占位图(可见、带说明文字)。准备好真实截图后,按以下步骤替换:

1. 把真实 PNG 放进本目录(文件名按上表)
2. 在 `packages/docs/zh/blog/2026-05-28-devtools-vs-harness-fe.md` 里把对应 `<img src="https://placehold.co/...">` 改回 `<img src="/blog/images/2026-05-28-devtools-vs-harness/0X-xxx.png">`
3. 英文版同步

搜索关键字:`placehold.co/` 找到 5 处。
