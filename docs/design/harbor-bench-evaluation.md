# Harbor Framework：harness-bench 跑分基建候选评估

更新：2026-10-20（同日二次核对官方文档后更新结论）。状态：机制层面评估为**可行**，未本地运行、未采纳。

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

## 关键疑虑与待验证

1. **文档结论未经实证**：以上全部来自文档核对，`BaseInstalledAgent` 容器内的实际行为（后台进程生命周期、daemon 存活、Chromium sandbox 参数）需要 spike 验证。
2. **数据集仍需自造**：注册表 364 个数据集几乎全是终端 / SWE 类，没有"活浏览器里的前端 UI bug"这一类；Harbor 解决 runner / 格式 / 生态，不解决数据问题（与 [harness-bench-analysis.md](harness-bench-analysis.md) 对 SWE-bench Multimodal 的结论一致）。
3. **镜像构建成本**：每个 bug 一个镜像、内含 npm install，批量跑的构建/缓存策略要设计（base 镜像预装依赖可缓解）。
4. **许可与治理**：框架与各数据集的 license、Hub 发布条款未核实。

## 下一步建议

一次 stub spike（零 API 成本）：挑 1 个现有 fixture，生成 Harbor 任务目录（Playwright base 镜像 + build 期打 patch + npm install），写自定义 agent 子类（stub 模式返回罐装 transcript），`tests/test.sh` 跑 oracle 写 reward.json，`environment_mode = "shared"`。验收标准：`harbor run` 本地 Docker 跑通单个任务、reward.json 指标齐全、stub 下 oracle 正确报 fixed=False。跑通后再决定立项与三条件真实跑分的预算。
