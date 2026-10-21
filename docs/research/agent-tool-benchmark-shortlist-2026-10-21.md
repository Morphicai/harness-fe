# Agent 工具对比：五个公开测试集候选

日期：2026-10-21。Owner：harness-fe。状态：**外部调研与选型建议，尚未实施新一轮评测**。

后续实现：[可迁移评测环境](../../bench/lab/README.md)已完成本机容器与模型连通验收，并固定[五套各十个评测单元](../../bench/lab/samples.json)。这是环境与清单交付，正式公开跑分、各数据集适配器与 Air 部署仍单独验收。下文的 Air 预检为搭建前的分时记录。

目标：比较同一个 Agent 使用 Harness-FE 或 Chrome DevTools MCP 时，能否把前端开发、前后端联调和网页操作任务真正做对。日志、截图和定位准确率用于解释结果；主要结果由功能验证决定。

## 选择结论

保留五个候选，优先接入 **Web-Bench**：它同时有前端交互开发与 React + Fastify 全栈项目，并提供可检查的 Playwright 测试。SWE-bench Multimodal v2 补充真实缺陷修复；FullStack-Bench 补充 UI/API/数据库联动；WebArena-Verified 与 VisualWebArena 分别覆盖常规和视觉网页任务。

这是 decision-autonomy 的轻量选型：只决定本地研究与后续接入顺序，没有修改工具接口或启动付费任务。依据是公开任务、评分代码和本仓已有实验；所有效果预期均为待验证假设。

| 候选 | 覆盖能力与规模 | 最终如何验证 | 采用判断 / 接入成本 |
| --- | --- | --- | --- |
| [Web-Bench](https://github.com/bytedance/web-bench) | 前端功能开发；部分项目可测前后端联动。官方说明为 50 项目 × 20 个有前置依赖的任务 | Playwright 检查交互、布局及业务结果 | **第一优先**；中等，需要把我们的 Agent 接到运行中的项目与浏览器 |
| [SWE-bench Multimodal v2](https://www.swebench.com/multimodal.html) | 真实 JS/视觉软件 issue 修复；当前 test 480 条、dev 100 条 | 补丁应用后执行官方测试，包括任务对应的回归/视觉测试 | **修复能力候选**；较高，评分可复用，活页面复现仍需逐仓接入 |
| [FullStack-Bench（FullStack-Agent）](https://github.com/mnluzimu/FullStack-Bench) | 完整应用开发与联调；101 个需求，647 个前端、604 个后端检查，389 个数据库需求 | GUI/API 评审 Agent 与数据库日志/快照联合评分 | **全栈补充候选**；较高，评分有模型不确定性，运行脚本需整理 |
| [WebArena-Verified](https://github.com/ServiceNow/webarena-verified) | 网页检索、后台写入与跨站操作；812 题，Hard 子集 258 题 | 官方确定性 evaluator，输入包含响应与独立网络轨迹 | **保留成熟基线**；本仓已跑通单站点，扩站点成本中等 |
| [VisualWebArena](https://github.com/web-arena-x/visualwebarena) | 图像定位、颜色/外观筛选、看图后完成网页任务；910 题 | 按题配置检查 URL、页面/业务状态或答案；部分涉及模型或图像判断 | **视觉网页候选**；中高，环境/图片资源与 evaluator 要预检 |

规模与评分依据：[Web-Bench 官方说明](https://github.com/bytedance/web-bench/wiki/Web-Bench-Introduction)、[SWE 数据集](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal)、[FullStack 论文 §2.3](https://arxiv.org/html/2602.03798v1#S2.SS3)、[WebArena-Verified 官方说明](https://github.com/ServiceNow/webarena-verified#dataset)、[VisualWebArena 官方说明](https://github.com/web-arena-x/visualwebarena#news)。

## 1. Web-Bench：先测功能做对，再解释工具价值

已经查看实际任务及测试，而不只看项目介绍：

- React 项目包含弹窗、表单、编辑/删除、搜索、状态共享、长列表、tooltip、路由等连续需求。[任务原文](https://github.com/bytedance/web-bench/blob/7b31ca2b786eef120dd49ce63dd03d0c0006046d/projects/react/tasks.jsonl)
- React `task-10` 检查搜索过滤、新增后搜索，以及输入框的位置和尺寸，适合测开发后的浏览器验证。[测试代码](https://github.com/bytedance/web-bench/blob/7b31ca2b786eef120dd49ce63dd03d0c0006046d/projects/react/test/task-10.spec.js)
- `fastify-react` 是 React + Fastify + SQLite 项目，需求包括鉴权、购物车、订单、支付、退款和权限。[任务原文](https://github.com/bytedance/web-bench/blob/7b31ca2b786eef120dd49ce63dd03d0c0006046d/projects/fastify-react/tasks.yml)
- `task-17` 检查支付结果、余额变化、库存变化，以及余额/库存不足的失败分支；`task-18` 检查用户申请退款、管理员审批与余额恢复。[支付测试](https://github.com/bytedance/web-bench/blob/7b31ca2b786eef120dd49ce63dd03d0c0006046d/projects/fastify-react/test/task-17.spec.js)、[退款测试](https://github.com/bytedance/web-bench/blob/7b31ca2b786eef120dd49ce63dd03d0c0006046d/projects/fastify-react/test/task-18.spec.js)

对比价值：观察 Agent 是否通过真实页面反馈发现并修正错误，最终完成交互与业务功能。Harness-FE 的请求/错误/状态关联可能有帮助；DevTools 也有网络、console 和截图，具备有竞争力的完成路径。优势必须由结果产生。

这些测试检查的具体行为不等于完整的数据库事务正确性证明；额外的持久化或并发断言如有添加，须作为单独的扩展评测报告。

接入路径：上游支持 `agentMode: http`，请求包括任务、文件与错误上下文，响应返回文件。适配层需要把工作目录、运行中的 dev server 和同一个浏览器交给我们的 Claude Code + Kimi Agent；仅把模型名称换成 Kimi，无法测量 MCP 工具的效果。[Custom Agent 接口](https://github.com/bytedance/web-bench/wiki/Custom-Agent)、[配置说明](https://github.com/bytedance/web-bench/wiki/Config-Parameters)

首个接入 pilot 采用 React、fastify-react 各一条原始 20 步项目链。后续任务依赖前序结果，**不能把第 17 题直接作为空仓独立问题**。项目链是统计上的相关样本；若另建统一的前置 checkpoint，必须注明这是受控变体，单列于原始链式结果。

## 2. SWE-bench Multimodal v2：真实前端修复的外部校验

本次发现旧研究需要更新：2026-09-01 官方宣布 v2 开放本地测试与评分。已同时核对官网、主仓 README、HF 元数据及数据服务：当前 **test 480、dev 100**，test 行包含 `eval_script` 等评分字段。旧版 617 条总量与当前 test 数量不可混用。[官网](https://www.swebench.com/multimodal.html)、[主仓说明](https://github.com/SWE-bench/SWE-bench)、[固定数据修订](https://huggingface.co/datasets/SWE-bench/SWE-bench_Multimodal/tree/4e6662d51c48e475f7f346e4fa09a6f8b31fcaa5)

补丁评分与浏览器探索可以并存：Agent 先读 issue、运行/调试、修改代码，最后由官方 evaluator 验证补丁。不能因为交付物是 diff，就把它认定为只允许静态生成代码的任务。

但评分环境不自动等于已接好 Harness-FE 的产品页面。候选任务必须先证明：原始问题能在本地重现、浏览器可接入、gold patch 能通过、未修复代码能触发相应失败。纯逻辑题、依赖已消失的外部站点或无法启动页面的题要标记，而不是默默剔除。

先用 dev 做接入验证，再冻结 test 子集。在 Agent 沙箱外保存 `patch`、`test_patch`、答案与评分资源；仅给 issue、允许的图片和仓库起点。公开筛选标准为可运行页面、技术栈和问题类型，不按哪一组更容易赢来筛选。

官方入口示意如下，**本次未执行**；固定版本安装后先确认 CLI 与镜像/任务仓契约：

```bash
# Reference-patch preflight, using the upstream v5 CLI documented in README
swebench eval multimodal --gold -i carbon-design-system__carbon-10188

# Grade our Agent's submitted patches; use a distinct run ID per condition/repeat
swebench eval multimodal -p predictions.jsonl --run-id hfe-mm-repeat-1 -j 1
```

上游仍支持旧的 Python module 入口。运行记录必须固定实际 CLI、镜像和数据修订；ARM 本地构建与旧仓库依赖是预检项。[官方运行说明](https://github.com/SWE-bench/SWE-bench#-usage)、[patch 格式与缓存规则](https://github.com/SWE-bench/SWE-bench/blob/02e7a74ffd0b707aab73d203fe87bdc7c76afc8e/docs/guides/evaluation.md)

## 3. FullStack-Bench：覆盖 UI → API → 数据库存储

这里选择的是 `mnluzimu/FullStack-Bench`，属于 FullStack-Agent 论文。已读取固定修订的 101 条 JSONL，数组数量与论文中的 647/604/389 一致。[数据集](https://huggingface.co/datasets/luzimu/FullStack-Bench)

适合的样例包括 `000018` 清洁服务预约、`000038` 公寓检索/预订及记录、`000081` 有保存和项目管理的 HTML 编辑器。它们要求实际数据流与存储，适合观察开发中出现问题后，Agent 能否完成前后端联调。它是从需求构建应用的基准，**不等同于一套已标注真实生产故障的修复集**。

评分要分别保留前端、后端、数据库结果：前端评审操作 UI；后端评审发现接口并请求；数据库检查使用日志及快照。评审依赖模型，前端有 YES/PARTIAL/NO，并非所有检查都是确定性断言。受测 Kimi 与固定的评审模型应分开配置；两组使用相同评审版本，争议样本盲审，并分开记录开发与评审成本。[论文评分方法](https://arxiv.org/html/2602.03798v1#S2.SS3)

接入须先整理项目启动契约、PostgreSQL、数据文件路径和评审 provider 配置。已查看的上游运行脚本存在作者机器的绝对数据路径和固定 provider 配置，不能直接称为开箱即用。[运行入口源码](https://github.com/mnluzimu/FullStack-Bench/blob/9e4cbb593e803309275cc642c5530f2092d7832b/src/eval_fullstack-dev/ui_eval_with_answer.py)

上游提供以下评分入口；应用生成由我们自己的同一 Agent 完成，保留上游评分语义，环境与路径适配单独记录：

```bash
bash src/eval_fullstack-dev/ui_eval_with_answer.sh "$WORKING_DIR_ROOT" "$LOG_DIR_ROOT"
```

这是候选运行路径，当前尚未为本仓完成适配或实际执行。环境与凭据继续经 morphix-env 注入，不复制上游固定配置。

## 4. WebArena-Verified：扩充已有网页任务基线

保留现有 runner、独立 HAR 和官方评分。下一轮扩充到 Shopping、GitLab、Reddit 等站点，以及检索/编辑/跨页流程；已有六个 Shopping Admin 样本作为历史 pilot 单列，不把它们当成新的独立验证。[官方环境](https://servicenow.github.io/webarena-verified/environments/)、[本仓 pilot](../../bench/webarena-verified/README.md)

该类任务给目标网站与用户指令，Agent 通过 UI 完成目标，不修改网站源代码或直接写数据库。结果由官方 evaluator 判断。Harness-FE 的历史上下文能否提高跨页操作成功率，以及 DevTools 的页面快照/输入路径是否更省步骤，均由新样本验证。

现成命令如下；这里只引用已有入口，没有启动新运行：

```bash
mx-env run -- node bench/webarena-verified/run.mjs --preflight
mx-env run -- node bench/webarena-verified/run.mjs --run
```

当前 manifest 仍是原来的六题，扩充前必须另行冻结新 manifest。`--run` 不会自动覆盖完整 812 题。官方原始分数保留，格式等价等补充诊断单列。

## 5. VisualWebArena：图片必须帮助完成任务

已读取三个站点的原始配置，共 Classifieds 234、Shopping 466、Reddit 210 题，总计 910。例子包括 Classifieds `task_id=0` 找最低价蓝色皮划艇、Shopping `task_id=0` 购买最低价红色毯子、Reddit `task_id=0` 根据输入图片找到帖子并进入评论区。[原始配置目录](https://github.com/web-arena-x/visualwebarena/tree/89f5af29305c3d1e9f97ce4421462060a70c9a03/config_files/vwa)

它把“截图返回成功”推进为“看图后选对对象并执行目标”。两组都使用 Kimi 的原生图片输入，获得相同任务参考图、viewport 与截图质量；不能只给 Harness-FE 参考图，也不能先把图片内容单独描述给一组。

Evaluator 有 URL、页面程序、字符串及图像检查；字符串 fuzzy-match 等分支还调用模型。需要按具体任务固定评分依赖与模型，不能把整个集合描述为完全确定性评分。配套 captioner 是特定 baseline 的选择，不应自动给我们的一组增配一个额外模型。[评分源码](https://github.com/web-arena-x/visualwebarena/blob/89f5af29305c3d1e9f97ce4421462060a70c9a03/evaluation_harness/evaluators.py)、[官方执行说明](https://github.com/web-arena-x/visualwebarena#end-to-end-evaluation)

先部署、重置站点，生成任务配置，校验输入图片，再把官方 evaluator 连接到同一个浏览器会话。原始 `run.py` 是上游 Agent 的入口；更换其 `--model` 不能直接变成本仓两个 MCP 条件的比较，需要 Agent adapter。网站 runtime 注入沿用可信评测控制器方式，记录 CSP、跨域页和注入失败的覆盖边界。[环境与重置说明](https://github.com/web-arena-x/visualwebarena/blob/89f5af29305c3d1e9f97ce4421462060a70c9a03/environment_docker/README.md)

## 综合比较方法

本仓已完成的两轮结果提供了起点：[WebArena 单站点](../../bench/webarena-verified/README.md)官方分数为 Harness-FE 5/6、DevTools 6/6；[自建诊断集](../../bench/runtime-diagnostics/README.md)两组根因正确率均 3/3，严格字段通过均 1/3。后者只确认诊断与证据链，不能替代修复成功率。

后续分三条能力线分别报告：

| 能力线 | 候选来源 | 主结果 | 辅助解释 |
| --- | --- | --- | --- |
| 前端开发与修复 | Web-Bench 前端项目、SWE-bench M v2 | 功能/回归通过率、官方 resolved | UI 缺陷、报错定位、截图消费、验证后返工 |
| 前后端开发与联调 | Web-Bench 全栈项目、FullStack-Bench | 业务流程通过；FullStack 的 FE/BE/DB 分项分数 | 请求/响应关联、存储状态、后端日志与浏览器现象的关系 |
| 网页任务执行 | WebArena-Verified、VisualWebArena | 官方最终任务成功率 | 输入/导航失败、视觉定位、跨页面状态、错误操作 |

所有能力线同时记录最终验收时间、token/成本、总工具调用和其中浏览器调用、超时/重试、环境失败。解决率优先，日志数量与截图数量不加分；模型评审分数与硬断言通过率保持各自含义。

两者的比较假设如下，作为实验解释框架，不预设胜者：

| 场景 | Harness-FE 待验证的价值 | Chrome DevTools 的对照价值 / 共同边界 |
| --- | --- | --- |
| 前端开发/修复 | 用错误、请求与页面状态关联缩短修改和复验循环 | 页面快照、表单操作和浏览器运行时检查同样可完成任务；既有 pilot 已观察到实时表单值的可见性差异，继续计入真实任务表现 |
| 前后端联调 | 把 UI 错误与请求响应、storage 发起栈及接收页面关联起来 | Network/console 同样能定位不少问题；两者都不能自动替代服务端日志和数据库验证，这些权限应等量提供 |
| 网页执行 | 持续记录与跨页上下文可能减少丢失状态后的重复探索 | DevTools 的直接页面操作可能更省调用；长流程结果与成本同时检验 |
| 视觉网页执行 | 原生图片与历史状态结合后能否帮助选对目标 | 两者都有截图；图片能正确送达只是准入条件，完成率由视觉定位和操作共同决定 |

### 公平对照

1. 同一 Claude Code 版本、Kimi `k3`、采样参数和工作流，仅切换浏览器工具。开发题两组都有相同代码读写、shell、构建与后端调试权限；网页题走 UI，无直改业务数据通道。
2. 固定可审阅 manifest、上游修订、浏览器与镜像、任务顺序及资源预算。原始项目链每次从同一起点开始；每个独立任务/重复重置数据库、登录态和浏览器 profile。
3. DevTools 保留正常的网络、console、截图和执行能力。两组采集器按同一时机接入，不通过重启 baseline 丢失历史。Harness-FE 注入方式与开销作为处理条件记录。
4. 开发题允许完整的“运行 → 观察 → 编辑 → 重新验证”循环；反馈次数和隐藏测试边界一致。trusted verifier 与 Agent 分离，避免读取 gold patch 或测试预期作弊。
5. 每题/项目链每组至少重复 3 次，交替条件顺序。报告成对胜/平/负和区间；Web-Bench 按项目链处理相关性，两个项目的接入 pilot 不足以推出全体项目排名。
6. 明确区分 `environment_failure`、`agent_failure`、`verification_failure` 与成功。冻结环境预检标准，保留被排除的任务及原因；不看结果后换题或改评分标准。
7. FullStack 与 VisualWebArena 的评审模型单独固定、盲化条件标签；开发成本与评审成本分开，CLI 估算与供应商账单注明来源。

### 建议接入顺序与下一轮范围

1. **先接 Web-Bench**：React + fastify-react 两条完整 20 任务链，验证浏览器联调、代码交付与官方测试闭环。若只有两条链，结果定位为接入 pilot。
2. **接 SWE-bench M v2**：dev 验证可运行环境与评分，再冻结约 10 个 test 任务；至少覆盖多种缺陷类型和多个仓库。
3. **扩网页任务**：WebArena-Verified 约 12 题，跨站点与操作类型；VisualWebArena 约 12 题，跨三个站点，包含参考图定位与视觉筛选。
4. **补全栈分项**：FullStack-Bench 约 8 个不同应用，先打通一个无外部付费 API 依赖的样例和评审链，再批量执行。

这些数量是待冻结 manifest 的范围建议，尚未形成已选任务清单或新的运行成绩。综合报告按三条能力线展示；链式任务数、独立修复实例数、完整应用数不混成一个无权重说明的总百分比。

Harbor 可以承接环境、Agent 生命周期与 verifier 调度，但五个候选不等于五个已可直接运行的 Harbor dataset ID。接入时复用各自官方评分：SWE 按实例、FullStack 按应用、WebArena/VWA 按网页任务；Web-Bench 保留项目链边界。这是后续 adapter 工作，当前没有声称已接好。

### Air 执行机连接预检（2026-10-21）

用户将下一轮范围定为每集合 10 个样本、分批比较，并要求评估迁到 MacBook Air。随后先暂停评测准备，检查 Nore 设备互联。以下为本次实际回执，不是新的 Agent 跑分；50 个样本尚未冻结或执行。

- 通过私网入口以严格主机指纹、公钥 SSH 登录成功，回读到 macOS 12.7.6、MacBookAir7,2、Intel i5-5250U、2 核/4 线程、8 GiB 内存；磁盘空闲约 780.9 GiB。目标是 Intel amd64，不能按 Apple Silicon 推断 ARM 兼容风险。机器专属 SSH 配置与网络地址保留在操作者本机。
- 同一私网 SSH 回读 Docker client/server 25.0.5，server 为 Linux amd64，并成功列出现有容器。这确认了实际远程执行与 Docker 查询路径；尚未验证五套数据集的环境或浏览器。
- 初始连续 6 次 TCP/SSH banner 探测，5 次在 0.453–1.651 秒收到 OpenSSH 响应，1 次超时；后续 3 次短探测仅 1 次取得 banner，并出现 40 秒连接超时与约 47 秒 banner 超时。ICMP 3 次仅 1 次回包。小样本只说明观察到波动，不推算长期丢包率或可用率。
- 私网 IPv6 目标本机无路由。IPv4 目标经 Nore sing-box 的虚拟接口转发；没有系统 100.x 网卡或独立 tailscale CLI，不能据此认定内置 endpoint 未连接。
- 当前 Trellis 会话仍报告 Air MCP 启动超时；另行执行只读 `air-task.py health` 也未在 60 秒内取得回执。Python 3.12.5 曾通过同一 SSH 实测返回，不能仅凭通用提示归因为未安装 Python。Linux worker 与 Dagu 当前健康尚未取得成功证据。
- 一次 SSH 连接复用探针因本机 Unix socket 路径过长失败，已改用短路径后重测；后者在连接阶段超时。前一次本机测试错误不计为远端网络失败。所有本轮探针均已退出，没有提交远程任务、修改 Nore 配置或重启宿主/worker。

执行建议：保留 IPv4 私网 SSH 入口；先核验持续连接与队列健康，再部署评测依赖并从单并发开始。Air 的实际预算为双核/8 GiB，各数据集的浏览器、后端与数据库组合需逐项测量内存。截图中的在线/直连状态不等于本轮已证明持续稳定，也不能据此认定队列可用。实际波动原因仍未锁定，NAT/中继切换、转发状态及宿主省电均只能列为待查项。[Tailscale 连接类型说明](https://tailscale.com/docs/reference/connection-types)、[sing-box endpoint 与系统接口选项](https://sing-box.sagernet.org/configuration/endpoint/tailscale/)

随后进行的 worker / LLM 就绪复核取得了新回执（2026-10-21 16:22，UTC+8），更新前述“未取得队列健康”的状态：

| 检查 | 本次实际结果 | 能证明的范围 |
| --- | --- | --- |
| Linux worker | 成功执行检查，Node v22.23.3、Claude Code 2.1.291、Trellis 0.12.0 | worker 和 Agent CLI 当前可运行 |
| Dagu | `/api/v1/health` HTTP 200，`status=healthy`，2.18.2 | 队列服务当前在线；不等于新的评测任务已提交/完成 |
| Agent 认证 | Claude `loggedIn=true`、`authMethod=oauth_token`、`apiProvider=firstParty`；Codex 登录状态成功 | CLI 认证可见；不等于已经证明本轮请求使用指定的 Kimi `k3` |
| 浏览器与工具 | worker PATH 未找到 Chromium/Chrome、chrome-devtools-mcp、Docker CLI、mx-env；无 Playwright 浏览器缓存 | 尚未验收这些 worker 执行依赖；宿主 Docker 已验证可用，不能混为 worker 内已经安装 |
| 评测代码 | worker 工作目录顶层未找到名称匹配 harness 的项目检出 | 尚未发现本仓评测入口，需要定位或部署；未做全盘扫描 |
| 持久任务模板 | 已有 scheduler 的 Claude/Codex 模板只读 | 还需要可编辑代码、启动浏览器/服务和执行 verifier 的专用评测入口 |

LLM 供应商已有历史验收证据：远程工作区 2026-10-07 的迁移与 marker 回读记录显示，GLM（`open.bigmodel.cn`）和 Kimi For Coding（`api.kimi.com`）都曾成功执行真实只读模型任务，最终默认供应商恢复为 GLM。该记录说明 Air 曾具备两家供应商，不冒充今天的 Kimi `k3` 端到端调用结果。只读查询当前供应商的尝试另行记录；在当前激活项和真实模型回执核对前，不把 Air 记为 Kimi 对比环境已验收。本次没有重新登录、读取密钥值或切换全局供应商。

## 未入选的来源

- [ByteDance FullStackBench](https://github.com/bytedance/FullStackBench)：同名但不同项目，主要是多语言代码评测与代码执行沙箱，不能直接替代活页面上的 UI/API/DB 联调。
- [Convex fullstack-bench](https://github.com/convex/fullstack-bench)：从内存前端补后端很匹配，但当前公开 README 仍描述手工 Cursor 会话与手工 grading；采用它需要另建可靠自动评分。优先使用已有评分的 Web-Bench 全栈项目与 FullStack-Agent 数据集。
- 本仓自建 runtime-diagnostics：保留为产品能力回归和诊断审计，不进入公开解决率主榜。

## 来源固定与复核边界

本次仅抓取公开说明、源文件、任务配置与数据集元数据；未拉起新的大型环境，未调用受测模型或评分模型。WebArena 本仓已跑通；其余四项达到**数据/源码可查**阶段，尚未达到本机端到端验收。

| 来源 | 本次核对的 Git / HF 修订 |
| --- | --- |
| bytedance/web-bench | `7b31ca2b786eef120dd49ce63dd03d0c0006046d` |
| SWE-bench/SWE-bench | `02e7a74ffd0b707aab73d203fe87bdc7c76afc8e` |
| SWE-bench/SWE-bench_Multimodal（HF） | `4e6662d51c48e475f7f346e4fa09a6f8b31fcaa5` |
| mnluzimu/FullStack-Bench | `9e4cbb593e803309275cc642c5530f2092d7832b` |
| luzimu/FullStack-Bench（HF） | `d3fe0e7828d121f78d85c5763b3166c1e09ba929` |
| ServiceNow/webarena-verified | `6473f72db5dcefc97b5725b59e734504edc28a21` |
| web-arena-x/visualwebarena | `89f5af29305c3d1e9f97ce4421462060a70c9a03` |

HF 数据服务 `size`/`splits` 与 API 元数据用于交叉核对行数；真正运行仍应下载固定修订并验证校验和。镜像可拉取性、官方参考解通过情况、runtime 注入、输入图片与评审 provider 的可用性仍需接入预检。
