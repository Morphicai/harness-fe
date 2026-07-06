# Research: 前端 UI 任务评测基准 —— 行业格局与技术空白点

> 状态：**调研 / 定位素材**，配合 [`harness-bench-analysis.md`](./harness-bench-analysis.md) 使用。本文档不涉及实现，只回答"这个赛道里已经有什么、判定原理是什么、harness-fe 能补哪块空白"，供 README/blog/issue 讨论引用。
>
> 方法：多 agent 并行检索 + 逐条断言 3 票对抗式验证（108 个子 agent，验证 12 条核心断言，推翻 1 条）。引用均为一手来源（论文/项目主页/官方仓库），置信度标注见文末。

## 一句话结论

**前端/UI 相关的评测基准已经形成三条清晰的赛道，但判定环节几乎都停留在"最终代码 diff + 单测通过率"或"最终截图视觉相似度 + LLM-as-judge 打分"这两条路径上，没有一个主流基准系统性利用 console 日志、network 请求、DOM 事件流、交互过程状态等运行时可观测信号做判定。** 这正是 harness-fe 能够差异化切入、且目前无人占位的技术空白。

## 三条赛道全景

| 赛道 | 代表基准 | 任务怎么来的 | 判定方式 | 是否用到运行时上下文 |
|---|---|---|---|---|
| **① Bug 修复类** | SWE-bench Multimodal | 真实 GitHub 仓库 issue/PR（17 个高星 JS 可视化库：图表/地图/语法高亮等），617 个实例 | F2P/P2P 单测通过率为主；仅 69/617（约11%，且只来自 Chart.js、openlayers 两个库）用像素级截图对比 | 执行环境 SWE-agent M 配了截图/看图能力（平均每实例截图 7.5 次），**全文未提及使用 console/network** |
| **② 设计还原类** | Design2Code / Web2Code | 人工筛选的真实网页截图（Design2Code 484 个，来自 C4 语料） | 纯"截图→代码"静态生成，判定完全基于渲染后截图的 CLIP 相似度/区块/文本/颜色匹配，或 GPT-4V 打分 | **无**——Web2Code 有个维度叫"UI Interactivity"，核实后其实仍是静态视觉相似度，不是真实交互测试。这是三条赛道里空白最彻底的一条 |
| **③ 端到端网页操作/Agent 类** | WebArena → BrowserGym 生态 | 真实/沙盒网站上的多步操作任务，人工设计 | 任务最终状态检查为主；新变体开始引入人工成对偏好投票 / LLM-as-judge | 部分涉及交互过程（多步操作序列），但判定仍看最终状态，不看过程中的 console/network |

## 2024–2026 新变体（③ 赛道内的演进）

WebArena 之后这条赛道没有停在原地，值得留意三个新方向：

| 基准 | 时间 | 核心思路 | 与 harness-fe 定位的关系 |
|---|---|---|---|
| **WebChoreArena** | 2025 | 532 个任务，直接构建在 WebArena 的 4 个可复现沙盒之上，专攻"繁琐劳动密集型"任务（海量记忆检索、精确计算、跨页面长期记忆）——WebArena 原版没系统覆盖的空白 | 说明"跨页面/跨时间的状态追踪"是被公认的评测难点，与 harness-fe 的 `session.tail` 跨 reload 保留时间线的能力方向一致 |
| **BrowserArena** | 2025 | 真实用户在**真实活网站**（非沙盒克隆）上提交任务，人工成对偏好投票（类 Chatbot Arena），并实验性引入 VLM 作 LLM-as-judge | **关键实证**：GPT-4o 与人工基线仅 68% 一致，o4-mini 仅 58%，纯视觉输入时降到 48%——第一手数据证明"纯截图/LLM 主观打分"的判定方式一致性差，这正是 harness-fe 提供结构化运行时信号可以改善的地方 |
| **StressWeb** | 2026-03（很新，未经同行评议） | 构造 clean vs perturbed（布局变化/交互语义改变/弹窗打断）环境对比，专测 agent 鲁棒性 | 方向新颖但样本量/社区采纳程度未知，暂不作为对标对象 |

## 判定方式的行业共识光谱

把上面所有基准按"判定信号"排成一条光谱，可以看到一个明显的断层：

```
单测通过率 ──── DOM/像素 diff ──── LLM-as-judge 打分 ──── 任务最终状态检查
(SWE-bench M)   (Design2Code)      (Web2Code/BrowserArena)   (WebArena)
                                                                    ↑
                                                          全部基于"最终结果"
                                                          没有一个基于"过程中的运行时信号"
```

已被业界公开验证的痛点：
- **视觉判定不鲁棒**：CLIP 相似度/像素 diff 对布局微调、字体渲染差异等敏感，容易把"语义正确但像素不同"误判为失败
- **LLM-as-judge 一致性差**：BrowserArena 实证 GPT-4o 与人工基线仅 68% 一致，纯视觉输入更是掉到 48%
- **静态代码 diff 判定不到"用户能不能感知到"**：单测通过 ≠ 界面真的对了（尤其是 CSS/交互类 bug，很多仓库根本没写对应测试）

## harness-fe 能补的空白（技术定位）

综合三条赛道，可以确认一个中等置信度但证据链完整的结论：**目前没有任何主流基准把 console 日志、network 请求、DOM 事件流、跨 reload 的交互状态纳入判定环节**。harness-fe 恰好能提供"执行轨迹级"的运行时上下文（console/network/DOM/截图一体化），可以用在两个方向：

1. **更细粒度的自动判定**：判断 agent 修复过程中是否触发了预期的网络请求、是否消除了 JS 报错、DOM 变更是否符合预期——比单一视觉相似度或单测通过率更贴近"这个 bug 真的被修好了"
2. **替代/增强 LLM-as-judge**：给 judge 喂运行时 timeline 而不是单张截图，理论上能缓解 BrowserArena 实证的一致性问题（这一点目前是推断，未经实测验证）

这与 [`harness-bench-analysis.md`](./harness-bench-analysis.md) 里"harness-fe vs Chrome DevTools MCP"的定位是同一个论点的两个层面：**前者是"agent 拿到运行时上下文能不能修得更好"，本文档是"评测本身能不能用运行时上下文判得更准"**——后者是一个目前行业里没人做、值得单独作为传播点的空白。

## 未验证到的缺口（留给下一步调研）

- **Chrome DevTools MCP / Playwright MCP 相关的调试类评测**：本轮调研没有找到已发表的对应 benchmark/leaderboard。大概率这个方向还停留在"工具生态"层面，没有形成标准化评测——这可能是一个可以抢先占位的空当，值得针对性地再查一轮（非论文，社区实践/GitHub issue 讨论为主）。
- **Mind2Web、VisualWebArena 的判定机制细节**：本轮只通过 BrowserGym 生态论文间接提及，没有做一手核实，是否也存在同样的运行时上下文缺失，待验证。
- **各基准的 GitHub star/引用量/是否有活跃 leaderboard**：本轮聚焦技术机制没有量化社区影响力，无法直接判断"切入哪个基准生态的传播杠杆最大"。
- 若要为某个现有基准（如 SWE-bench Multimodal）提供运行时上下文增强的判定方案，技术对接点（插件层 vs 修改官方 harness）如何设计，尚未有答案。

## 关键来源

- SWE-bench Multimodal 论文：https://arxiv.org/html/2410.03859v1
- SWE-bench 官网 / 仓库：https://www.swebench.com/SWE-bench/ ・ https://github.com/swe-bench/SWE-bench
- Design2Code 论文 / 项目主页：https://arxiv.org/pdf/2403.03163 ・ https://salt-nlp.github.io/Design2Code/
- Web2Code 项目主页：https://mbzuai-llm.github.io/webpage2code/
- BrowserGym 论文：https://arxiv.org/pdf/2412.05467
- WebChoreArena 论文：https://arxiv.org/pdf/2506.01952
- BrowserArena 论文（LLM-as-judge 一致性数据出处）：https://arxiv.org/html/2510.02418v2
- StressWeb 论文：https://arxiv.org/pdf/2604.16385

> 已被推翻的断言（3 票中 0 票支持）：「SWE-bench 判定不依赖仓库自带测试用例，而是以'已解决问题百分比'为核心指标」——已核实 SWE-bench 判定核心确实是隐藏测试套件的 F2P/P2P 通过率，不是这种笼统表述。记录于此避免复述错误结论。
