# Design: harness-bench —— 技术方案（如何把对比真正跑起来）

> 状态：**技术方案 / 待评审**，承接 [`harness-bench-analysis.md`](./harness-bench-analysis.md) 的结论（对比对象是 harness-fe vs Chrome DevTools MCP vs 纯代码，被测 agent 仅 Claude Code）。本文档回答四个具体问题：数据从哪来、有没有现成数据集能直接用、怎么让三档对比自动跑起来、怎么把结果变成分数。仍然只是方案，不在本文档里跑真实调用（跑 Claude Code 会真花钱，见文末"需要拍板的点"）。

## 1. 数据源：有没有现成开源数据能直接用？

在写 `harness-bench-analysis.md` 时已经排除了 SWE-bench Multimodal（静态 patch，没有浏览器）。这次又核实了一个新的候选：

| 数据集 | 内容 | 能不能用 |
|---|---|---|
| **BugsJS**（[bugsjs.github.io](https://bugsjs.github.io/)，真实存在，453 个真实 JS bug，来自 10 个流行 Node.js 服务端程序，自带 Docker 基建 + 25k+ 测试用例） | 服务端 Node.js 程序的真实回归 bug，Mocha 测试驱动 | **不能用**——这些都是**服务端**程序（无 DOM、无浏览器、无 UI），bug 复现完全在 Node 进程里，压根不存在"打开页面点一下"这种场景。harness-fe 和 Chrome DevTools MCP 的核心能力都是浏览器运行时观测，这类数据集里两者都用不上，测出来的差异毫无意义 |
| **SWE-bench Multimodal**（已在分析文档里排除） | 17 个前端库的真实 issue | 见前文档——没有活的 dev server/console/timeline |
| 其他公开前端 bug 数据集（Bears、Defects4J 系）| 均是 Java 生态 | 语言不对，直接排除 |

**结论：目前没有一份"真实前端 bug + 可在浏览器里复现 + 有运行时信号"的现成开源数据集。** 这不是没找全，是这类数据集的采集成本本身就很高（需要保留可运行的历史环境 + 浏览器可复现步骤），学术界目前的数据集普遍退化成"静态 patch + 隐藏测试"（SWE-bench 系）或"纯服务端"（BugsJS 系），刚好把 harness-fe 想验证的那类信号排除在外了。

**因此 v1 数据源维持分析文档的结论：手工埋雷，不外接数据集。** 具体做法：
- 从 `examples/react-demo` / `vue-demo` / `iframe-demo` 的 git 历史里找真实的 bugfix commit（`git log --oneline -- <目录>` 过一遍，挑有明确前后行为差异的）
- 对每个挑中的 commit：`git revert <fix-commit>` 得到"埋雷后"的代码状态，commit message 里写清楚这是哪次真实修复的镜像
- 每个 bug 配一个 `oracle.sh`（复用该 commit 原本改动的测试文件，跑不过就是 bug 复现成功；agent 修完之后再跑一次，通过即算修复成功）
- 数量和难度分布沿用分析文档：15–20 个，三档 5–7 个，选题偏向"无 stack trace"和"跨 reload 复现"两类

### 1.1 bug 实例 schema —— 对齐 SWE-bench，而不是自造字段名

见 `harness-bench-analysis.md`"harness-bench 相对 SWE-bench 的定位"一节的结论：`metadata.json` 的字段对齐 SWE-bench 的实例格式，而不是随手起名字：

| 字段 | 含义 | 对应 SWE-bench 概念 |
|---|---|---|
| `problem_statement` | 用户口吻的 bug 描述，喂给 agent 的 prompt | `problem_statement` |
| `fail_to_pass` | 修复后必须变绿的断言（oracle 的主检查） | `FAIL_TO_PASS` |
| `pass_to_pass` | 修复后**不能被破坏**的既有功能断言，防止用一个偷懒/破坏性的改动骗过窄断言（比如把整个按钮禁用掉来"解决"崩溃） | `PASS_TO_PASS` |
| `ground_truth_location` | 人工标注的正确定位，用于算"首次定位精确率" | harness-bench 特有，SWE-bench 没有这个指标 |

`oracle.mjs` 相应地要跑两组断言而不是一个笼统的布尔值：先跑 `fail_to_pass`（修复前必须失败、修复后必须通过），再跑 `pass_to_pass`（不管修复前后都必须通过——如果修复后突然不通过了，说明 agent 的改动破坏了其他功能，即便 `fail_to_pass` 通过了也要判定整体失败）。

## 2. 评测框架：不从零写 runner，复用 Inspect AI 做骨架

调研发现 [Inspect AI](https://inspect.aisi.org.uk/)（UK AI Safety Institute 出品，开源 Python 框架）已经覆盖了这次要造的轮子里最重的三块：

1. **数据集/任务抽象**（`Sample`：`input` + `target` + `metadata`，`Task`：dataset + solver + scorer）—— 我们只需要把 15–20 个 bug 塞进这个结构，metadata 里放 repo 路径、埋雷 commit、oracle 脚本路径、ground-truth 定位
2. **外部 CLI agent 当 solver 的官方支持**——文档明确写了"支持跑任意外部 agent，比如 Claude Code、Codex CLI、Gemini CLI"，不用我们自己写 agent loop、自己接 Anthropic API、自己维护对话状态
3. **Docker sandbox 编排**——`Task` 上声明 `sandbox="docker"`，配一个 `Dockerfile`/`compose.yaml`，Inspect 负责每个 sample 起/收容器，不用我们手写容器生命周期管理
4. **scorer/metrics 记录**——支持自定义打分函数 + 自定义指标（token、cost 都有现成的记录位）
5. **结果查看**——自带 `inspect view` 看每个 sample 的完整 transcript，不用我们另外做 dashboard

**结论：`harness-bench` 不是"从零写一个评测工具"，而是"给 Inspect AI 写一个 Task 插件"。** 我们要写的代码只有三块：① bug 数据集（纯数据，见上一节）、② 一个 solver 函数（调用 Claude Code headless 并按档位切换 `.mcp.json`）、③ 一个 scorer 函数（跑 oracle + 解析 Claude Code 输出算指标）。这是相对小的工作量，且復用了一个被 AISI 官方维护、专门为"agent + 工具 + 沙箱"这类评测设计的框架，比我们自己攒一个 runner 更可信、更容易被外部审计（issue 里提到"community-auditable test suite"，用一个已知框架比自造轮子更能服众）。

## 3. 怎么让"三档对比"自动跑起来

### 3.1 关键支点：Claude Code headless 模式原生支持我们需要的一切控制点

不需要自己写 agent 循环或解析工具调用协议——Claude Code CLI 本身就是被测系统，而且它的 headless（`-p`/`--print`）模式刚好覆盖了跑 benchmark 需要的所有控制维度：

| 需求 | Claude Code 原生支持 |
|---|---|
| 非交互、脚本可控 | `claude -p "<bug 描述 prompt>"` |
| 精确控制这次调用能看到哪些 MCP 工具 | `--mcp-config <每档一个 json 文件> --strict-mcp-config`（后者保证不会漏读仓库里遗留的 `.mcp.json`，三档之间干净隔离） |
| 拿到 token/成本 | `--output-format json` 返回结果里带 `total_cost_usd`、`session_id` |
| 拿到逐步工具调用序列（用来算"首次定位精确率""修对前步数"） | `--output-format stream-json`，每行一个事件，包含 `tool_use`/`tool_result` |
| 不需要人工审批工具调用 | `--allowedTools` 预授权，或 `--permission-mode acceptEdits` |

也就是说，"怎么让对比跑起来"这个问题的答案是：**同一个 bug、同一个仓库状态，起三次 `claude -p`，每次换一个 `--mcp-config`，用 shell 侧计时 + Claude Code 自报的 JSON 拿到所有需要的信号。** 不需要额外的"agent 抽象层"。

### 3.2 三档具体怎么接容器/环境

| 档位 | 环境准备 | MCP 接入方式 |
|---|---|---|
| **A — harness-fe** | 容器内 `pnpm install && pnpm dev`（用已发布的 `@harness-fe/vite` + `@harness-fe/runtime`，不需要 workspace 源码），dev server 起在容器内 | 用**solo stdio 模式**：`.mcp.json` 写 `npx @harness-fe/cli mcp`，daemon 自动起在 loopback。相比 `examples/docker` 现成的 governed 网关镜像（`morphixai/harness-fe:latest` + issue-token 流程），solo 模式更适合 bench——单 agent、单机、不需要 RBAC/token 生命周期，启动更快、失败面更小 |
| **B — Chrome DevTools MCP** | 同一个容器需要一个 headless Chrome（`npx @puppeteer/browsers install chrome` 或直接用带 Chrome 的基础镜像） | `.mcp.json` 写 `npx chrome-devtools-mcp@latest`，指向容器内跑起来的 dev server URL |
| **C — 纯代码** | 只需要仓库源码，不需要起 dev server（除非 oracle 脚本本身需要跑起来验证，那就仍然需要起 server，只是不接任何 MCP） | `.mcp.json` 写 `{"mcpServers": {}}` + `--strict-mcp-config` |

**容器基础镜像建议：** 三档共用一个基础镜像（Node 20 + Chrome + pnpm），按档位只是换 `.mcp.json` 和要不要装 harness-fe 插件——这样 Inspect 的 `sandbox` 配置可以三档复用同一个 `Dockerfile`，减少维护面。

### 3.3 bug 的"复现前置动作"怎么给 agent

每个 bug 的 prompt 应该是一段**用户口吻的问题描述**（"点击购物车里的加号，数量没有变化"），不能替 agent 写好"打开 XX 路由、点击 XX 按钮"这种操作步骤——那样等于替 agent 做了定位工作，会抹平三档之间的差异。三档拿到的 prompt 完全一致，唯一变量是它们各自能调用的工具。

v1 明确**不**用 harness-fe 的 overlay/`tasks_pending` 入口（即不预先提交一条帶标注的任务给 agent 去 `tasks_claim`）——虽然这是 harness-fe 的一个真实差异化能力，但引入它会让"入口方式"和"运行时工具"两个变量绑在一起，污染单变量消融。这个入口方式的优势留到 v1.1 单独做一次"prompt vs 任务上报"的消融，不在本轮跑。

### 3.4 让浏览器真正跑起来——两种工具的浏览器生命周期模型不一样，必须分别处理

这是本方案里最容易被忽略、但决定了"跑不跑得起来"的一环：**harness-fe 和 Chrome DevTools MCP 对"谁负责启动浏览器"的假设完全不同**，不能用同一套启动脚本糊弄过去。

**先说清楚为什么必须要有一个真的浏览器在跑：** harness-fe 的核心信号（console/network/session timeline）不是静态存在的，是运行时 SDK 在页面里跑起来之后才产生的；Chrome DevTools MCP 同理，得先有一个 Chrome 实例被 CDP 接管。如果 bench 只是"起个 dev server、代码扔给 agent"，两个工具都拿不到任何真实信号，等于测了个寂寞——所以浏览器必须真的跑起来，而且必须让**同一个 bug 的用户操作真的在浏览器里发生过**，运行时数据才有意义。

**两种工具的浏览器生命周期天然不同：**

| | harness-fe | Chrome DevTools MCP |
|---|---|---|
| 谁启动浏览器 | 需要**外部先起一个浏览器**，导航到 dev server URL，让页面里的 `@harness-fe/runtime` SDK 启动并通过 WS 连上 daemon，daemon 才会有 `tab.list` 可见的 tab | **自己管理浏览器生命周期**——agent 第一次调用 `new_page`/`navigate_page` 时，MCP server 会自己拉起/接管一个 Chrome 实例，不需要外部预先准备 |
| 原因 | 架构是"运行时 SDK 挂在页面里，主动上报"——没有页面加载就没有 SDK 实例 | 架构是"MCP server 直接用 CDP 控制浏览器"——浏览器本身就是它的执行环境，不依赖被测应用主动做任何事 |

**因此 Condition A 需要一个"预热"步骤，Condition B 不需要：**
1. 容器启动 → `pnpm dev` 起 dev server → 起 `npx @harness-fe/cli mcp`（daemon）
2. **只有 Condition A**：用 headless Chromium（复用仓库已有的 `@playwright/test` 依赖——`examples/react-demo` 的 `e2e/*.e2e.ts` 已经在用它跑 harness-fe 的端到端测试，同一套 Playwright 脚本模式可以直接拿来写"预热"脚本）导航到 dev server 首页，健康检查确认 `tab.list` 能看到这个 tab、WS 已连上，再调用 `claude -p`
3. **Condition B**：不需要预热，直接调用 `claude -p`，agent 第一次调 `navigate_page` 时 Chrome DevTools MCP 自己会拉起浏览器
4. **Condition C**：如果 oracle 是纯单测，不需要任何浏览器；如果 oracle 需要在浏览器里断言（见下），单独为 oracle 阶段起一次 Playwright，跟 agent 阶段无关

**bug 复现本身谁来做——agent 自己做，不预先录制好。** 预热步骤只是让浏览器"存在"、SDK"连上"，**不**代替 agent 完成"点击购物车加号"这个复现动作。复现和诊断都由 agent 自己调用 `page.click`/`page.navigate`（harness-fe）或 `click`/`navigate_page`（Chrome DevTools MCP）来做。这一点很关键，也正是这个 benchmark 真正想测的东西：*要求 agent 自己动手复现一遍*，harness-fe 的 `session.tail` 才有可能在"跨一次 reload"之后还留着这次复现动作的记录，而 Chrome DevTools MCP 的 console/network 在 agent 自己触发的那次 reload 之后会被清空——**这正是困难档 bug 设计要考的东西，如果预先把 telemetry 灌好，这个差异点就测不出来了。**

## 4. bug 集合要同时覆盖 UI 层和业务逻辑层

之前分析文档里的三档（简单崩溃栈 / 无报错逻辑错误或视觉回归 / 竞态-跨reload）是按"harness-fe 和 Chrome DevTools MCP 差异有多大"分的，现在再加一个正交维度——**bug 的性质**，确保集合里不会全是视觉类问题：

| bug 性质 | 例子 | 复现方式 | oracle 类型 |
|---|---|---|---|
| **UI 层** | 按钮点击后 loading 状态没消失、弹窗定位偏移、CSS 导致元素被遮挡、响应式布局在某个宽度下重叠 | 需要在浏览器里操作 + 观察渲染结果 | 浏览器驱动的断言（截图对比 / 查询 DOM 属性），复用 `examples/react-demo/e2e` 现有的 Playwright 断言模式 |
| **业务逻辑层** | 购物车合计算错、分页 off-by-one、过滤条件写反、状态更新时序错误导致的脏读 | 可能需要浏览器操作触发，但断言点是数据/状态而非像素 | 可以是纯逻辑单测（如果状态可以脱离 UI 单独断言），也可以是浏览器驱动断言（读某个 DOM 上展示的数字） |

**15–20 个 bug 的分配建议：** 三个难度档 × 两种性质，尽量做到每个难度档里 UI 层和业务逻辑层各占一半（比如中等难度档 5–7 个里 3 个 UI、3-4 个业务逻辑），避免"只测出 harness-fe 在视觉 bug 上强"这种片面结论——issue 原本举的例子（组件崩溃、逻辑错误/视觉回归、竞态）本身已经是混合的，这里是把这个混合显式化成一个选题时要检查的维度，而不是选完 15 个才发现全是视觉类。

## 5. 怎么把结果变成分数

| 指标 | 怎么算 | 数据来源 |
|---|---|---|
| 修复成功率 | oracle 脚本 exit code（0 = 通过） | 每个 bug 自带的 `oracle.sh`，agent 结束后在容器里跑 |
| 修对前步数 | 数 `stream-json` 里 `tool_use` 事件的数量，直到 agent 最后一次改动文件后 oracle 首次通过为止 | Claude Code `--output-format stream-json` |
| 首次定位精确率 | 第一次带有具体 `file:line`/`selector`/`loc` 参数的工具调用，比对编写 bug 时记录的 ground-truth 位置（人工标注，写在 Inspect `Sample.metadata` 里） | 同上 + 数据集 metadata |
| 单次修复 token 成本 | 直接读 `total_cost_usd`（或 `usage.input_tokens`/`output_tokens`） | Claude Code `--output-format json` |
| wall-clock 耗时 | shell 侧 `time claude -p ...` 掐表，不依赖 Claude Code 自报（自报的是模型推理时间，不含容器/工具调用的真实等待） | shell |

**汇总方式：** 每个 sample 跑完产出一行结果（bug id、档位、六个指标），落地成 Inspect 的 eval log（JSON），用一个几十行的小脚本把三档按 bug/按难度档聚合成 Webwright 风格的头条数字 + delta 表（例如："harness-fe: 82% fix rate / avg 4.2 steps，Chrome DevTools MCP: 65% / avg 7.1 steps，code-only: 41% / avg 11 steps"）。这个聚合脚本是本方案里少数需要手写、且不复用 Inspect 内建能力的部分——因为"按难度档分组 + 三档并排"是我们特有的报告形状，Inspect 自带的 viewer 只到"看单次 eval 的所有 sample"这一层。

## 6. 需要拍板的点（本文档不擅自决定/执行）

- **真实调用 Claude Code = 真实花钱。** 15–20 个 bug × 3 档 = 45–60 次真实 API 调用，具体预算取决于每次调用的平均 token 量（有 harness-fe/Chrome DevTools MCP 加持的档位工具调用更多，成本可能更高）。**正式跑 pilot 前需要用户确认预算和用哪个账号/key**，这属于 CLAUDE.md 里"涉及金钱的操作需先确认"的红线，不会擅自跑。
- **容器镜像用 `examples/docker` 现成的 governed 镜像，还是新做一个更轻的 solo 版？** 本方案推荐后者（理由见 3.2），但这意味着要新写一个 Dockerfile，不是零成本复用——如果你觉得直接用现成镜像更省事也可以，代价是每个 bug 都要走一次 issue-token 流程。
- ~~Inspect AI 引入一个新的 Python 依赖到本仓库（monorepo 目前是纯 TS/JS 生态），是否接受技术栈混入~~ —— **已确认可以接受**，按第 2 节方案推进。
