# harbor-spike — Harbor 承载 harness-bench 任务形态的可行性实测

对应设计文档 [`../../docs/design/harbor-bench-evaluation.md`](../../docs/design/harbor-bench-evaluation.md)
的"下一步建议"。本目录是一个**零 API 成本**的拓扑验证：把现有 fixture
`react-demo/easy-counter-increment-crash` 包装成 Harbor 任务，用 Harbor 的
oracle agent（执行 `solution/solve.sh`，不调用任何模型）跑通全链路。

## 验证点

1. Harbor 任务环境能构建出"vite 应用 + 注入 bug + headless Chromium"的容器；
2. agent 阶段能起后台服务（dev server）并访问（solve.sh 冒烟验证）；
3. `[verifier] environment_mode = "shared"` 下 verifier 能看到 agent 阶段的文件改动；
4. Playwright oracle 在容器内跑通，多指标写入 `reward.json`。

不在本 spike 范围：真实模型跑分（claude-code agent + MCP 三条件）、
harness-fe daemon/prewarm 链路（需自定义 `BaseInstalledAgent`，下一阶段）。

## 运行

```bash
cd packages/harness-fe/bench/harbor-spike
./prepare.sh          # 生成 environment/app（react-demo 副本，workspace:* → latest）
harbor run -t tasks/easy-counter-increment-crash -a oracle --jobs-dir jobs
```

预期：trial 成功，`reward.json` 含 `fixed: 1`（solve.sh 已应用金标准修复）、
`oracle_duration_s`、`multi_metric_proof`。

## 结构

```
tasks/easy-counter-increment-crash/
  task.toml              # environment_mode="shared" 是关键行
  instruction.md         # 来自 fixture metadata.json 的 problem_statement
  environment/
    Dockerfile           # playwright 镜像 + npm install + 注入 bug.patch
    app/                 # prepare.sh 生成（gitignored）
    bug.patch            # prepare.sh 从 fixtures 复制
    oracle/              # oracle.mjs + package.json（build 期装到 /opt/oracle）
  tests/test.sh          # 跑 oracle → /logs/verifier/reward.json
  solution/
    solve.sh             # dev server 冒烟 + patch -R 应用金标准修复
    fix.patch            # = bug.patch（反向应用即修复）
```
