# Harbor Framework：harness-bench 跑分基建候选评估

更新：2026-10-20（同日完成本机 spike 实证）。状态：**拓扑可行性已实证**（零 API 成本），未采纳为实施承诺。

> 本文 2026-10-20 从 morphix root 仓 `research/` 迁入本仓——按 owner 边界规则，harness-bench 的基建选型属于本仓的设计材料，与 [harness-bench-analysis.md](harness-bench-analysis.md)、[harness-bench-tech-design.md](harness-bench-tech-design.md) 并列。

## 问题

harness-bench（`bench/`，对标 [#174](https://github.com/Morphicai/harness-fe/issues/174)）目前走 Inspect AI + 自建 `runner.py` 的路线，推进不理想。需要评估现成 agent 评测基建能否复用，作为验证 harness-fe 能力（对比 Chrome DevTools MCP / 无工具）的跑分底座。

## Harbor 是什么

[Laude Institute](https://www.laudeinstitute.org/)（Terminal-Bench 团队）的开源 agent 评测框架：

- **注册表**：[hub.harborframework.com/datasets](https://hub.harborframework.com/datasets) 现有约 364 个数据集，包括 terminal-bench 2.x（89 任务）、swe-bench-verified（500）、swe-bench-pro（731）、aider-polyglot（225）、skillsbench（87）、algotune（154）、swe-rebench-leaderboard（860）等，以终端 / SWE 类为主。
- **任务格式**：标准目录 `instruction.md` + `task.toml` + `environment/Dockerfile`（或 `docker-compose.yaml`）+ `tests/test.sh` + 可选 `solution/solve.sh`。
- **执行**：容器化沙箱（Docker、Daytona、Modal、Fly.io、LangSmith），`harbor run -d <dataset> --agent <agent> --model <model>`；`uv tool install harbor` 安装。
- **Agent 集成**：预置 claude-code、codex、gemini-cli、openhands、swe-agent、terminus-2、aider 等；`--ak key=val` 传 agent 参数、`--ae VAR=val` 传环境变量；自定义 agent 继承 `BaseInstalledAgent`（agent 装在任务容器内运行，官方推荐）或 `BaseAgent`（agent loop 在宿主机，通过 `environment.exec` 驱动容器）。
- **判定与轨迹**：`tests/test.sh` 在 agent 结束后运行，写 `/logs/verifier/reward.json`（**支持多指标**，不止二元 pass/fail）；ATIF（Agent Trajectory Interchange Format）记录完整交互轨迹；支持 regrade（重跑判定不重跑 agent）。
- **生态**：`harbor adapter init` 移植外部基准（CompileBench 已有[公开迁移案例](https://quesma.com/blog/compilebench-in-harbor/)）；与 Inspect AI 有 [inspect_harbor](https://github.com/meridianlabs-ai/inspect_harbor) 集成；[LangChain 官方博客](https://www.langchain.com/blog/unified-stack-for-evaluating-agents)有联合方案。

来源：[GitHub harbor-framework/harbor](https://github.com/harbor-framework/harbor)、[官方文档](https://docs.harborframework.com/)、[Harbor Hub](https://hub.harborframework.com/datasets)。机制结论来自文档核对，未本地运行。

## 机制核对结果（2026-10-20 二次核对）

针对首轮的"浏览器/daemon 拓扑"疑虑，逐条核对了官方文档：

1. **拓扑问题——机制上成立**。`BaseInstalledAgent` 的语义就是"Harbor 把 agent CLI 安装并运行在任务容器内"（官方推荐模式）。这意味着 claude CLI、harness-fe loopback daemon、dev server、headless Chromium 可以全部在同一个容器里跑，`127.0.0.1` 互通——与现在 `bench/bench/runner.py` 在本机的编排完全同构。Chromium 依赖用 Playwright 官方镜像做 base 即可。
2. **Verifier 默认在独立沙箱，不继承 agent 的文件改动**——必须设 `environment_mode = "shared"`，否则 oracle 看不到 agent 修过的代码。这是一个配置行，但漏了会全盘误判。
3. **多指标原生支持**：`reward.json` 是 labeled numeric metrics 的 JSON 对象，`fixed` / `steps_to_first_fix` / `precise_first_location` / `total_cost_usd` 可以全部写进去，正好覆盖 `SampleResult` 的字段。
4. **三条件的实现路径**：task.toml 的 `[[environment.mcp_servers]]` 是 URL 型（transport/url/headers），harness-fe daemon 的 ws 地址能挂上；但 Chrome DevTools MCP 是 stdio npx 启动，URL 型挂不上。因此**三条件统一走一个自定义 `BaseInstalledAgent` 子类**最忠实：把 `runner.py` 里"写 .mcp.json → prewarm → `claude -p --strict-mcp-config`"这一段原样搬进 agent 类，条件作为 `--ak condition=harness-fe` 参数传入，不依赖 Harbor 对 MCP 的内置处理。
5. **A/B/C 对比的组织方式**：Harbor 是"一个 job = 一个数据集 × 一个 agent 配置"，不像 Inspect solver 那样一个 sample 自动展开三条件。三条件 = 三个 job（同数据集换 `--ak condition=...`），结果跨 job 对比——Harbor 有 datasets/metrics 与 leaderboard 机制承载这种对比，组织上反而更清晰。
6. **成本闸门保留**：stub 自检模式可以作为 agent kwarg（`--ak stub=true`）原样保留，避免误触真实 API 花费（延续 `bench/README.md` 的 money gate 硬规则）。

## 与 harness-bench 现有资产的映射

| 现有资产 | 迁移去向 |
| --- | --- |
| `bench/fixtures/<bug>/`（bug.patch + metadata.json + oracle.mjs） | 任务目录生成器的输入：一个 fixture 生成一个 Harbor 任务（fixtures 保持单一事实源，任务目录是生成物） |
| `runner.py` 的 checkout/patch/npm install | `environment/Dockerfile`（build 期完成，层缓存天然加速批量跑） |
| `runner.py` 的 vite config / .mcp.json / prewarm / `claude -p` | 自定义 `BaseInstalledAgent` 子类（约 50–80 行，直接移植现有逻辑） |
| oracle.mjs（Playwright 断言） | `tests/test.sh` 调用同一脚本 + 写 `reward.json`（含 PASS_TO_PASS 第二断言） |
| `extract_metrics`（stream-json 解析） | agent 类的 `populate_context_post_run`，指标写进 AgentContext / reward.json |
| Inspect AI（task.py 适配层） | 退役——我们对 Inspect 的使用只有一层薄适配，没有沉没成本 |
| `HARNESS_BENCH_STUB=1` | `--ak stub=true` agent 参数 |

## 潜在价值

1. **标准格式 + 公开注册表**：直接回应 [#174](https://github.com/Morphicai/harness-fe/issues/174) 的 community-auditable 诉求；未来可把我们的前端 bug 数据集发布到 Hub。
2. **规模化执行**：云端沙箱后端（Daytona/Modal/Fly）省去自建并行基建。
3. **轨迹分析**：ATIF 能回答"agent 到底有没有用上 harness-fe 的工具、用得对不对"。
4. **regrade**：修 oracle 后不用重跑 agent（省钱），现有 Inspect 路线要重跑。

## Spike 实证结果（2026-10-20，本机 Docker + Harbor 0.24.0）

spike 代码在 `bench/harbor-spike/`（分支 `spike/harbor-topology-20261020`）：把 fixture `react-demo/easy-counter-increment-crash` 原样包装成 Harbor 任务，用 oracle agent（只执行 `solution/solve.sh`，**零 API 成本**）跑通全链路。四个验证点全部通过：

| 验证点 | 结果 | 证据 |
| --- | --- | --- |
| 任务环境构建（playwright 镜像 + npm install + build 期注入 bug.patch） | ✅ | 首次构建 2m38s，缓存后整轮 21s |
| agent 阶段能起后台服务（vite dev server）并访问 | ✅ | solve.sh 冒烟：`[solve] background dev server reachable ✓` |
| `environment_mode = "shared"` 下 verifier 看到 agent 阶段的文件改动 | ✅ | 金标准修复后 oracle 全绿，`fixed: 1` |
| Playwright oracle 容器内跑通 + 多指标 reward.json | ✅ | `{"fixed": 1, "oracle_duration_s": 5, "multi_metric_proof": 1}`，各指标在 job 汇总表独立成列 |

**负向对照**：不应用修复重跑，oracle 正确抛断言失败、`fixed: 0`——verifier 有判别力，不是恒绿。

实证中发现的落地细节：

1. **vite 7 的 dev server 默认只绑 `localhost`（Node 17+ 解析为 IPv6 `::1`）**，探 `127.0.0.1:5173` 会全部超时。真实迁移时 prewarm/daemon 的目标地址要注意这一点（oracle helper 显式 `host: '127.0.0.1'` 所以不受影响）。
2. **`harbor run --mcp-config <path>` 是全局 flag**（Claude 风格 .mcp.json，可重复），且已核对 claude-code agent 源码：它把 stdio 型 server 原样写进 `$CLAUDE_CONFIG_DIR/.claude.json`（user scope，无信任弹窗），与我们的 `harness-fe.mcp.json.tmpl` 形状一致——MCP 注入不需要自定义 agent。
3. **Harbor 会覆盖容器 CMD 为 `sleep infinity`**，Dockerfile 的 CMD/ENTRYPOINT 不会执行——dev server / daemon / prewarm 必须由 agent 在 run() 里拉起（自定义 agent 的真正职责只剩这一个）。

### 条件 A stub 实证（同日第二轮，零模型成本）

自定义 `BaseInstalledAgent` 子类（`bench/harbor-spike/harbor_agents.py`，约 60 行）在容器内完整复现了条件 A 链路，只是最后把 `claude -p` 换成 MCP 层探针：

| 步骤 | 结果 |
| --- | --- |
| dev server（harnessFE 插件版 vite config）后台启动 | ✅ |
| prewarm 拉起 `harness mcp` daemon + headless Chromium tab，runtime SDK 注入确认 | ✅ |
| MCP 探针（= claude 的 stdio MCP 客户端去掉模型）：initialize → tools/list → tab.list | ✅ `initialized=true, toolCount=63, tabCount=1, firstTabUrl=http://localhost:5173/` |
| reward.json 双指标 | ✅ `fixed: 0`（stub 不修 bug，正确阴性）+ `mcp_topology: 1` |

至此"能不能改"的最后一个开放机制问题已关闭：**条件 A 特有的 daemon/浏览器/MCP 链路在 Harbor 任务容器内完整成立**，真实跑分只差把探针换回 `claude -p`（以及 `--mcp-config` 或自定义 agent 二选一）。

另一个实测发现：**发布版 @harness-fe/cli v4.5.2 的 MCP 工具名是点分格式**（`tab.list`、`page.click`），与旧文档的下划线格式（`tab_list`）不一致——迁移时所有工具调用名要以发布版为准（已记录在 spike 代码注释）。

## 数据集结论（2026-10-20 逐个人工核实）

注册表 364 个数据集中与 web 相关的只有 3 个，**没有一个覆盖"运行中前端应用的 bug 修复"**：

| 数据集 | 任务数 | 实际内容 | 对我们的用途 |
| --- | ---: | --- | --- |
| blobfishai/webbench | 159 | 浏览器内 SaaS 操作（WebArena 家族），Playwright CLI 驱动、无代码仓库 | 无直接用途；其"可执行判定、无 LLM judge"的设计可参考 |
| webgen-bench/webgen-bench | 101 | 从需求文档生成整个 web 应用，VLM judge | 无——生成赛道 |
| billxbf/mimo-v26-webdev | 2,093 | 从设计稿建站、截图 VLM 打分（Apache-2.0） | 无——设计还原赛道 |

结论：我们的前端 bug fixtures 仍需自造（与 [harness-bench-analysis.md](harness-bench-analysis.md) 的判断一致），Harbor 提供 runner / 格式 / 生态。若要真实模型冒烟，terminal-bench 或 hello-world 是最便宜的现成任务。

## 关键疑虑与待验证

1. ~~浏览器/daemon 拓扑~~ **已实证**（oracle 模式 + 条件 A stub 两轮，见上节）。剩余唯一未验证项：真实 `claude -p` 在容器内的行为（`--allowedTools`/permission-mode 通过 `--ak` 的传法、stream-json 落盘位置）。
2. **数据集仍需自造**：见"数据集结论"一节。
3. **镜像构建成本**：首次 2m38s（含基础镜像拉取 + 双 npm install），缓存后 21–45s；批量跑的 base 镜像预装策略可按此数据设计。
4. **许可与治理**：框架与各数据集的 license、Hub 发布条款未核实。

## 下一步建议

**预算确认后**即可做真实跑分 pilot：三条件（harness-fe / chrome-devtools-mcp / none）各跑 1 个真实样本（条件 A 用 stub agent 的 run() 把探针换成 `claude -p`，或 stock claude-code agent + `--mcp-config`），对比 ATIF 轨迹与现有 stream-json 指标抽取，再决定是否批量迁移 5 个 fixtures。真实跑分调用 `claude -p` 产生真实 API 费用，遵守 bench/README.md 的 money gate。
