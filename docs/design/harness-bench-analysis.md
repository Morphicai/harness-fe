# Design: harness-bench —— 先看现成体系能不能用，再决定要不要自建

> 状态：**分析 / 提案**，针对 [#174](https://github.com/Morphicai/harness-fe/issues/174)。目前没有 runner 代码、没有数据集、没有 Docker 基建——本文档只回答"哪些能复用、哪些要自建"，并给出 v1 pilot 的范围。

## 问题重述

[#174](https://github.com/Morphicai/harness-fe/issues/174) 想要一个可引用的头条数字——对标 Webwright 的跑分展示方式——来证明 harness-fe 的核心价值主张：**给 agent 运行时上下文（console、network、session timeline、精确 `file:line`）比只给它代码，能更快更准地修复前端 bug。**

真正有意义的对比不是"harness-fe 开 vs 关"这种真空里的自我消融——而是**harness-fe vs 大家没有它时会用的替代工具**。这一类里最直接、最真实的竞品是 **Chrome DevTools MCP**（Google 官方发布的、用来驱动一个实时 Chrome 实例的 MCP server）。只有这个对比才能产出站得住脚、可引用的结论；纯粹的开关消融只能证明"harness-fe 的工具不是没用"，证明不了"它比替代方案强"。

在从零建 `harness-bench` 之前，本文档先核实现成的评测体系/基建能复用到什么程度，并把 Chrome DevTools MCP 作为主要对比基线纳入设计。

## 现有体系扫描结论

| 体系 | 实际测的是什么 | 可复用的部分 | 剩下为什么不能直接搬 |
|---|---|---|---|
| **Chrome DevTools MCP**（[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)，Google 官方）——约 50 个工具：输入自动化、导航、性能 trace、network、console、heap snapshot、Lighthouse | *实时 CDP 会话检查*——针对**当前选中页面、且从上次 navigation 之后**的 console/network/heap/performance | **不是拿来当基建复用的，而是真正的对比对象**——它是没有 harness-fe 时 agent 今天就会用的工具 | 详见下方对比表——这是真正的"Condition B"，不是拿来抄代码的系统 |
| **Webwright**（[microsoft/Webwright](https://github.com/microsoft/Webwright)）——Online-Mind2Web（86.7%，300 个真实网站导航任务，LLM-as-Judge）+ Odysseys（60.1%，长程网页操作任务） | *浏览器导航任务完成率*——"agent 能不能在一个真实网站上完成这个多步操作" | **打分展示方式**（一句话头条百分比 + 一张小表，"比前 SOTA 高 N 分"）值得照搬到我们展示结果的方式上 | 这是导航/任务完成类评测，不是修 bug 评测，也不是 agent 会用来替代 harness-fe 的**工具**——它是另一套面向不同任务的 agent 框架。没有数据集或基建可以搬 |
| **SWE-bench Multimodal**（617–619 条真实 GitHub issue，来自 17 个 JS 库：设计系统、地图、语法高亮等） | *静态补丁生成*——仓库 + issue 文本/图片 → patch → 隐藏测试套件通过与否 | 真实、和前端相关，未来可以用来做**难度校准 / 外部可信度背书** | 没有活的 dev server、没有浏览器、任务里不包含 console/network/timeline——harness-fe 存在的意义所需要的那些信号，在这个数据集里天然不存在。要用它就得给 17 个陌生的库仓库重新接 harness-fe，并手动在浏览器里复现每个 bug 生成 telemetry——工程量跟造一个新数据集差不多，不算复用。而且这些是库级别的 bug（设计系统的组件/API bug），不是用户会点来点去的完整应用 |
| **Debug2Fix**（MSR 论文——pdb/jdb 子 agent 消融，Java/Python，GitBug-Java + SWE-bench-Live） | *工具消融对通过率的影响*：同一个 agent、同一个模型，唯一变量是"有没有交互式调试器工具" | **这是该抄的方法论**——单变量消融、用既有测试套件当 pass/fail oracle、一张 delta 表（有工具 vs 没工具的通过率） | 语言栈不对（Java/Python）、工具类别也不对（stdio 调试器 vs MCP 运行时可观测性工具）——这里没有代码能直接跑，只有实验设计可以照着抄 |

### harness-bench 相对 SWE-bench 的定位：借实例格式，不借执行 harness

重新审视后发现一个更站得住脚的定位：**harness-bench 理论上可以看作 SWE-bench 方法论的一个子集/变体**——不是复用它的数据集（这点已经排除），而是复用它的**实例结构和打分规范**，把"换模型"这个自变量换成"换工具配置"：

| SWE-bench 概念 | harness-bench 的对应物 |
|---|---|
| `base_commit`（bug 存在时的代码状态） | 应用了 `bug.patch` 之后的 checkout |
| `problem_statement` | `metadata.json` 里的 `user_prompt` |
| `FAIL_TO_PASS`（修复后必须变绿的测试） | oracle 的主断言 |
| `PASS_TO_PASS`（修复后不能被破坏的既有测试，防退化解） | **目前缺失**——现在的 oracle 只判定"目标行为对了"，没有防"用一个偷懒的改动骗过窄断言"（比如把整个按钮禁用掉来"修掉"崩溃） |
| 自变量：模型 | 自变量：工具配置（harness-fe / Chrome DevTools MCP / 纯代码） |

**这个定位要拆成两半说清楚，不能笼统地说"我们用 SWE-bench 的方法"：**

1. **可以借、值得借的：实例 schema + 打分规范。** 把 bug 的 `metadata.json` 对齐 SWE-bench 的字段命名（`problem_statement`/`FAIL_TO_PASS`/`PASS_TO_PASS`），并给每个 bug 补一条 `PASS_TO_PASS` 断言——这不是为了"看起来像 SWE-bench"，是因为 `PASS_TO_PASS` 解决了一个我们现在真实存在的缺口（防退化解）。用一个被广泛认可的实例格式，也比自造字段名更容易被外部审计（回应 issue #174 里"community-auditable"的诉求）。
2. **不能借、也没必要借的：SWE-bench 自己的执行 harness**（`run_evaluation.py`、按实例构建 Docker 镜像、套用一份现成 patch 文本再跑测试）。那套 harness 处理的是"**给定一份已经生成好的 patch 文本，套用它，跑测试**"——patch 怎么产生的它完全不关心，通常是模型一次性输出的静态 diff。harness-bench 的核心诉求恰恰是**agent 要在一个真实运行的浏览器里，通过 MCP 工具边探索边改**——这一段 SWE-bench 的执行 harness 完全没有、也不可能有（它没有浏览器、没有 dev server、没有运行时工具的概念）。`bench/runner.py` 里"起浏览器、起 dev server、用不同 `.mcp.json` 调 `claude -p`"这一段必须自己写，这正是这个 benchmark 存在的意义所在，是不能外包给任何现成 harness 的部分。

一句话定位：**harness-bench 是 SWE-bench 风格的实例格式，套在一个 SWE-bench 覆盖不到的执行维度（运行时工具可用性）上。**

### harness-fe vs Chrome DevTools MCP —— 真正的差异应该来自哪里

Chrome DevTools MCP 在工具数量上更广（heap snapshot、性能 trace、Lighthouse、扩展控制——这些 harness-fe 都没有）。一个公平的跑分要瞄准 harness-fe 和它**结构性不同**的地方，而不是宣称全面碾压：

| 维度 | Chrome DevTools MCP | harness-fe |
|---|---|---|
| console/network 的作用范围 | 按 tab，**每次 navigation 就重置**（"since the last navigation"） | 按 session 持久化的 JSONL timeline，跨 reload/navigation 存活 |
| 源码定位 | 依赖浏览器自己的 sourcemap 在报错栈里解析出的位置 | 构建期在每个 DOM 节点上打的 `data-morphix-loc`/`data-morphix-comp` + `project.where_is`——即使没有抛出异常也能定位 |
| 跨 reload / 跨 tab 的连续性 | 没有——每个 CDP 会话都是独立的世界 | `session.tail`/`session.summary` 能跨 reload 重建时间线；`visitor.journey` 能跨 tab |
| bug 上报入口 | 没有——agent 必须已经知道哪里出问题了 | 页面内 overlay 让用户提交带标注的报告，变成一条 `tasks_pending`，agent 能主动领取 |
| 接入方式 | 启动/接管一个独立的 Chrome 实例（通过 CDP） | 接入应用自己的 dev server（Vite/Webpack/Next 插件） |
| 广度（性能 trace、heap snapshot、Lighthouse、扩展） | 广得多 | 完全没有——不在 harness-fe 的范围内 |

**对跑分设计的含义：** harness-fe 该赢的场景应该是那些明确需要 (a) **没有报错栈也要精确定位**，或 (b) **要重建当前页面状态之前发生了什么**（一次 reload、两个事件之间的竞态）——因为这两个轴恰好是 Chrome DevTools MCP 结构性做不好的地方。一个简单的、单次 navigation 内就能复现的报错栈崩溃应该是**打平**的——两个工具解决起来应该差不多，跑分要诚实地展示这一点，而不是只挑对 harness-fe 有利的 bug。

**仓库现状核查：** `packages/harness-fe/scripts/` 目前只有 `demo.sh` 和 `release-publish.sh`——本仓库里没有任何评测/跑分基建。不管最终建什么，runner 本身都是从零开始。

**工具名纠正（发布任何引用本文的内容前必须先改）：** issue 里提出的工具名并不存在。按 [`packages/docs/reference/mcp-tools.md`](../reference/mcp-tools.md)，实际的工具是：

| issue 里写的 | 实际工具 |
|---|---|
| `console_get_logs` | `console.tail`（未处理错误用 `errors.tail`） |
| `session_get_timeline` | `session.tail`（原始时间线切片）/ `session.summary`（元数据 + 事件计数） |
| （隐含的定位需求） | `project.where_is`（组件/文件 → 位置）和 `project.source`（读源码） |

## 落地建议

**不要移植 SWE-bench M 的评测基建。** 它是面向 Python/仓库补丁的 harness，没有浏览器循环；把它改造成能驱动"活的 dev server + 浏览器 + MCP 工具调用"的流程，改造成本比自己写一个小的 TypeScript runner 更高。

**把 SWE-bench M 留作未来的语料池，不作为 v1 依赖。** 它的 bug 叙事在方法论本身被验证之后，可以用来做难度校准和外部可信度背书（"在一个已知公开 benchmark 的子集上得到验证"）——但不是现在。

**照抄 Debug2Fix 的实验设计，并扩展成三档对比。** 模型、prompt、仓库、bug 在所有档位之间完全冻结一致；唯一的变量是 agent 拥有哪些 MCP 工具。被测 agent 范围收窄为**仅 Claude Code**（v1 不做跨 CLI 对比）——所以每一档只是同一份 checkout 换一份 `.mcp.json`：

| 档位 | `.mcp.json` 内容 | 目的 |
|---|---|---|
| **A —— harness-fe** | harness-fe 条目 + 已安装 `@harness-fe/skill`，dev server 跑着 harness-fe 插件 | 被测系统本身 |
| **B —— Chrome DevTools MCP** | `chrome-devtools-mcp` 条目，不接 harness-fe | **真正的对比对象**——今天没有 harness-fe 时 agent 会用的东西 |
| **C —— 纯代码** | 不接任何 MCP 条目，只有源文件 | 下限基线，主要用来证明两个工具都能跑赢它 |

pass/fail 的判定用既有测试套件（或者给手工埋雷的 bug 写一条针对性断言脚本）——不靠人工肉眼判断。

**v1 数据源从 SWE-bench M 改成 harness-fe 自己的 examples。** `examples/react-demo`、`examples/vue-demo`、`examples/iframe-demo` 已经接好了 harness-fe。手工"埋雷"（revert 一个修复 commit，或者注入一个针对性的回归）就能**免费获得一个真实运行的 dev server + 真实 console/network/timeline 数据**——零额外 instrumentation 成本——并且直接命中待验证的核心论点（运行时信号有用）。这样 v1 pilot 完全绕开了 SWE-bench M 的 instrumentation 税。

**指标：** 保留 issue 原本的四个——
- 修复成功率（主指标）
- 修对前的步数（平均多少次工具调用才产出正确 patch）
- 首次定位精确率（第一次工具调用是否落在正确的 `file:line`）
- 单次修复的 token 成本

——再补两个 issue 没提到的：
- **单次修复的实际耗时（wall-clock time）**（光看 token 成本抓不住经济性论证——跑得慢但便宜不一定算赢）
- **每个 bug 明确的 pass/fail oracle 定义**——必须是脚本或既有测试，在 bug 编写阶段就定好，不能事后推断

**pilot 规模：** 沿用 issue 自己的提法——约 15–20 个手工埋雷的 bug，分三档（每档 5–7 个），选题时专门瞄准 harness-fe 和 Chrome DevTools MCP 结构性不同的那两个轴（见上方对比表），而不是随便挑通用前端 bug：

| 难度档 | bug 类型 | 为什么能拉开两个工具的差距 |
|---|---|---|
| 简单 | 组件崩溃，报错栈清晰 | 应该大致**打平**——两个工具从一个抛出的异常里解析源码位置都没问题。放进来是做健全性检查，不指望它偏向 harness-fe |
| 中等 | 静默的逻辑错误 / 视觉回归，**没有抛出异常、没有报错栈** | Chrome DevTools MCP 在没有报错的情况下没有任何可以锚定的信息；harness-fe 的 `project.where_is`/`data-morphix-loc` 能直接从 DOM 定位到组件 |
| 困难 | 只有**跨一次 reload 或多步骤用户操作**才能复现的 bug（竞态、navigation 后的陈旧状态） | Chrome DevTools MCP 的 console/network 会随 navigation 重置；harness-fe 的 `session.tail`/`session.summary` 能跨 reload 保留完整时间线 |

v1 每个 bug 在每个档位（A/B/C）各跑一次——对应 issue 自己提的"先跑 20 个 bug 的 pilot，发表方法论再跑全量"。重复采样评估方差是харness 本身被验证之后的 v2 议题。

## v1 之后的路径

- **什么时候引入 SWE-bench M：** 一旦 v1 pilot 的 harness（runner、oracle 格式、指标采集）在手工埋雷的 bug 上跑通验证过，再把同一个 runner 扩展到一小批 SWE-bench M 任务上（前提是先给那几个目标库仓库接上 harness-fe instrumentation）——这一步验证的是外部泛化能力，不是方法论本身。
- **什么时候扩展到 Claude Code 以外：** 跨 agent/CLI 对比（Cursor、Codex CLI、裸 API）是单 agent 消融数字跑出来且稳定之后的独立后续工作；runner 的"档位切换"抽象应该保持 agent 无关，这样以后扩展不用重写，但这个抽象怎么设计不在本文范围内。

## 风险与已知局限（明说，不藏着）

- **pilot 规模小（15–20 个 bug）。** 这个规模跑出来的头条百分比是方向性的，不是统计学意义上稳健的——发布时要标注"pilot"，直到规模扩大。
- **v1 没有重复采样**，意味着捕捉不到同一模型跑多次之间的方差；单次运气好/不好的一跑可能拉偏某个档位的数字。
- **手工埋雷的 bug 是我们自己写的**，存在无意识地把 bug 设计得对 harness-fe 的工具有利的风险。缓解办法：从真实的历史修复 commit 反向生成 bug（revert 一个真实的过去修复），而不是凭空造合成 bug，并且尽量用原始 commit 自带的测试差异作为 pass/fail oracle。
- **三个 example 应用都是小型单一用途的 demo**——不能代表真实生产应用的复杂度。"困难"档（竞态）在 demo 应用里可能比较浅；timeline 工具的完整优势可能只有在更大的应用上才能体现，这是 v2 语料该覆盖的方向。
- **Chrome DevTools MCP 是个还在变化的目标，而且比 harness-fe 广得多**（heap snapshot、Lighthouse、性能 trace、扩展）——跑分必须严格限定在"修 bug"这个任务上，不能演变成"harness-fe vs Chrome DevTools MCP 全能力对比"，那样 harness-fe 光靠广度就会输。
- **跑 Chrome DevTools MCP 每次都需要一个真实的、受 CDP 控制的 Chrome 实例**——这会给 runner 增加基建重量（每个 bug × 档位都要管理一次 headless Chrome 生命周期），这一点在 runner 设计时要如实纳入考量，不能一笔带过。

> 后续技术方案（数据源核实、Inspect AI 复用、三档怎么自动跑起来、指标怎么算）见 [`harness-bench-tech-design.md`](./harness-bench-tech-design.md)。

## 下一步任务清单（替代 issue 原本的 checklist）

- [ ] 在正式开始实现之前，先把纠正后的工具名作为评论发到 #174（草稿见下），避免有人照着错的工具名去搭
- [ ] 针对 `examples/react-demo` / `vue-demo` / `iframe-demo` 编写 15–20 个手工埋雷的 bug（每档 5–7 个，偏向对比表里的那两个轴），每个都配一条脚本化的 pass/fail oracle
- [ ] 搭一个最小 runner：每个 bug 准备三份 `.mcp.json`（harness-fe / chrome-devtools-mcp / 都不接），同样的 Claude Code prompt，采集完整 transcript + token 用量 + wall-clock + 工具调用序列
- [ ] 每个 bug 在每个档位跑一次 pilot，算出上面四+二个指标，发布方法论 + 数字，并标注"pilot"
- [ ] 根据 pilot 结果，决定要不要投入 SWE-bench M 的 instrumentation 做外部泛化验证，以及要不要把更多竞品 MCP 工具（比如 Playwright MCP）纳入对比

## Draft comment for #174

> Did some digging before starting on `harness-bench` — sharing findings in case it changes the design:
>
> 1. **Tool names in the proposal don't match current API** — `console_get_logs` / `session_get_timeline` aren't real tools. Current equivalents: `console.tail` / `errors.tail` for console, `session.tail` / `session.summary` for timeline, `project.where_is` / `project.source` for location. Worth fixing before anyone builds against this doc.
> 2. **The comparison that will actually land is harness-fe vs. [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)** (Google's official MCP for driving live Chrome), not just harness-fe on/off. That's the tool people reach for today in harness-fe's absence, so it's the real Condition B. Proposing a 3-way design: harness-fe / Chrome DevTools MCP / code-only. Chrome DevTools MCP's console+network reset per navigation and has no build-time source-location mapping — those two gaps are where harness-fe's `session.tail` and `data-morphix-loc` should show a real edge; a plain stack-trace crash should be a wash between the two and the benchmark should report that honestly.
> 3. **Webwright's benchmarks (Online-Mind2Web, Odysseys) measure browser-navigation task completion, not bug-fixing, and it isn't a competing tool** — useful only for *how to report results* (headline %, delta table).
> 4. **SWE-bench Multimodal doesn't have a live app to attach any MCP tool to** — its 617 tasks are static repo+patch+hidden-test, from library repos, with no dev server/console/network as part of the task. Reusing it means re-instrumenting 17 unfamiliar repos and hand-reproducing each bug in a browser — about as much work as building a new corpus. Better fit as a v2 external-validity check.
> 5. **Debug2Fix (MSR, interactive-debugger ablation for coding agents) is the closest methodological match** — single-variable ablation, existing test suite as oracle, delta table. Proposing we copy that experiment design, extended to 3 conditions instead of 2.
> 6. **harness-bench is best thought of as a SWE-bench-shaped instance format applied to an axis SWE-bench doesn't cover** — each bug instance adopts SWE-bench's `problem_statement`/`FAIL_TO_PASS`/`PASS_TO_PASS` schema (the last one is a real gap our first draft was missing — it stops an agent from "fixing" a bug by disabling the feature entirely), but SWE-bench's own execution harness (apply a finished patch string, run tests) doesn't apply here — we still need our own runner to drive a live browser and hand the agent different MCP tool configs mid-task, which is exactly the dimension SWE-bench has no concept of.
>
> Proposed v1: hand-seed ~15–20 bugs (revert real fix commits) into harness-fe's own `examples/react-demo` / `vue-demo` / `iframe-demo`, biased toward "no stack trace" and "only reproducible across a reload" cases where the two tools structurally differ — run Claude Code with harness-fe / with Chrome DevTools MCP / with neither, same prompt/model, score against the four metrics in the original proposal plus wall-clock time.
