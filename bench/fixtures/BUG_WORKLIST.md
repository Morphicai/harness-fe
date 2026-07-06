# bug 数据集清单 — 已完成 3 个，剩余 12-17 个待补

按 `harness-bench-tech-design.md` §4，目标是 15-20 个 bug，3 档难度 × 2 种性质（UI / 逻辑）。本轮只完整实现了 3 个（全部在 `react-demo`，全部是 `category: logic`），因为这是唯一一个在本次实施里源码被完整读过、能对每一行 diff 负责的 demo app。**没有臆造对 vue-demo / iframe-demo 或 react-demo 里 StylesPage/FormsPage/ErrorsPage/SandboxPage 源码的补丁**——在真正动手写那些 patch 之前，必须先像 `easy-counter-increment-crash` 这三个一样把目标文件完整读一遍，否则行号/上下文对不上，`patch -p1` 会失败或者更糟——悄悄 apply 到错误位置。

## 已完成

| id | app | tier | category |
|---|---|---|---|
| `react-demo/easy-counter-increment-crash` | react-demo | easy | logic |
| `react-demo/medium-counter-decrement-silent` | react-demo | medium | logic |
| `react-demo/hard-network-race-stale-response` | react-demo | hard | logic |

**已知缺口：目前 3 个全是 `logic`，一个 `ui` 类都没有。** 下一步优先补 UI 类，不能让最终 15-20 个 bug 里 UI 类占比过低——这正是 `harness-bench-tech-design.md` §4 明确要求避免的片面结论来源。

## 待补清单（目标分布：每档 5-7 个，UI/逻辑各半）

### easy（崩溃 + 清晰报错栈，预期两个工具打平，主要做健全性检查）
- [ ] react-demo / ui / `StylesPage.tsx` 或 `FormsPage.tsx` 里一个渲染时崩溃的 bug（比如把某个必然为 `undefined` 的字段直接 `.toUpperCase()`）——**先读这两个文件**再写 patch
- [ ] react-demo / logic / `SandboxPage.tsx` 或 `ErrorsPage.tsx`（这两个页面本来就是"测试报错"用的，可能已有可以直接借用的崩溃入口，需要先读源码确认是不是"预期内"的崩溃演示而非真 bug）
- [ ] vue-demo / ui or logic / 先读 `examples/vue-demo/src` 结构，找一个等价于 CounterPage 的组件
- [ ] iframe-demo / ui or logic / 先读 `examples/iframe-demo/src` 结构，注意这个 demo 的特殊性是父子 iframe，埋雷时要想清楚 bug 应该埋在父页面还是子页面，两者对 harness-fe 的 `parentProjectId` 追踪能力是不同的测试点

### medium（静默逻辑错误 / 视觉回归，无报错栈）
- [ ] react-demo / ui / `StylesPage.tsx` 里一个纯 CSS/布局回归（比如某个元素在特定状态下被错误的样式遮挡或错位）——这是本清单里最典型的"视觉类" bug，优先补
- [ ] react-demo / logic / `FormsPage.tsx` 里一个校验逻辑写反的 bug（比如必填校验判断条件取反）
- [ ] vue-demo / ui / 等价的视觉回归
- [ ] vue-demo 或 iframe-demo / logic / 静默状态计算错误

### hard（竞态 / 跨 reload 才能复现）
- [ ] react-demo / ui / 一个"刷新后样式状态丢失"类的 bug（比如某个用户交互设置的视觉状态在 reload 后没有正确恢复/持久化，需要设计成"有恢复机制但恢复逻辑有 bug"而不是"压根没做持久化"，否则不算 bug 只是缺功能）
- [ ] iframe-demo / logic / 利用父子 iframe 结构设计一个"子页面状态变化后，父页面没有正确同步"的 bug——这个特别适合测 harness-fe 的跨 iframe session 追踪能力（`session.tail`/`visitor.journey`），是 Chrome DevTools MCP 完全没有对应能力的场景，值得优先补
- [ ] vue-demo / logic / 类似 `hard-network-race-stale-response` 的竞态，但换成 Vue 的响应式系统语境（比如 watcher 的执行时序问题）

## 补充新 bug 的流程（照抄这三个已完成的做法）

1. 先用 `Read` 完整读一遍目标文件，不要凭记忆/摘要写 patch
2. 手写 diff 后，**必须**像本轮一样用 `patch -p1 --dry-run` 在目标文件的临时拷贝上验证能 apply、且 apply 后内容和预期完全一致，再落盘
3. metadata.json 的 `problem_statement` 用纯用户口吻描述症状，不能透露"打开哪个路由点哪个按钮"这种操作步骤（会替 agent 做定位工作，抹平三档差异，见 `harness-bench-tech-design.md` §3.3）；同时要写 `fail_to_pass`（修复后必须成立的行为）和 `pass_to_pass`（修复后不能被破坏的既有行为，防退化解，见 §1.1）
4. oracle 优先复用 `bench/fixtures/_lib/browserOracle.mjs` 的 `withApp` helper；如果是跨 iframe/跨 reload 的 hard 类 bug，`withApp` 目前只支持单个 vite root，需要先扩展它支持"起两个 vite server（父子）"或者直接在 oracle 里手写，不要硬套
5. **写完 oracle 后必须两头验证，且不能想当然认为"不打 patch 的 HEAD = 已修复"**：
   - 打了 `bug.patch` 的 checkout 上跑 oracle，必须 FAIL（复现成功）
   - **不要假设**不打 patch 的原始 HEAD 就是"已修复"状态去验证 PASS——`hard-network-race-stale-response` 就踩了这个坑：react-demo 的 `NetworkPage.tsx` 本来就完全没有防串台的 guard，所以哪怕不打任何 patch，HEAD 一样会 FAIL 同一个 oracle。**正确做法是手写一份"如果 agent 真的修对了会长什么样"的版本**（在打了 patch 的 checkout 上手动改成正确实现），拿这份手改版本去跑 oracle 验证 PASS，而不是拿 HEAD 去跑
   - 只有当这个 bug 确实是"HEAD 本来是对的，patch 引入了退化"这种情况（比如 `easy-counter-increment-crash`、`medium-counter-decrement-silent` 这两个），HEAD 才能直接当"已修复"参照物用
