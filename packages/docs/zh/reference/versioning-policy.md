# 版本策略

> 本文是关于**选哪种 bump**。运维流水线(merge 后的 PR 如何到 npm、3.x/4.0 双线、`BLOCKED` 陷阱)见 [operations/release-flow.md](https://github.com/Morphicai/harness-fe/blob/main/docs/operations/release-flow.md)。

本仓库是 monorepo,核心包之间**版本 linked**(见 `.changeset/config.json` —— `linked: [...]`)。一个包的 bump 会把所有 10 个拽到同一个版本号。这带来干净的"all-3.1.0"安装故事,但也意味着**一个不经意的 `minor` changeset 会在整个生态里看起来像 major-looking 的跳跃**。

当前在 linked 组里的包:

```
@harness-fe/protocol      @harness-fe/vite
@harness-fe/mcp-server    @harness-fe/webpack
@harness-fe/runtime       @harness-fe/unplugin
@harness-fe/node-runtime  @harness-fe/next
@harness-fe/log           @harness-fe/react-jsx
```

未 linked(独立版本号):

```
@harness-fe/dashboard-ui   (随 mcp-server 的 tarball 一起发)
@harness-fe/agent-skill    (独立关注点)
```

**linked 组不变量**:每次发布后所有成员必须在同一版本。changesets 在每次发布时统一版本来强制这一点;若成员漂到不同 major,下一次 bump 会被迫为 `major`,让大家重新对齐到同一数字。当 `@harness-fe/log` 和 `@harness-fe/react-jsx` 落后时,我们直接在它们的 package.json 中追到 3.x——这是一个手工的 release engineering 步骤,不是 changeset 驱动的跳跃。追上后,常规 `patch` / `minor` bump 跨 10 个包都干净。

## Pre-1.0 / pre-launch 姿态

我们已经把 3.x 发到了 npm,**但产品还没公开 launch**。用户 / 合作伙伴还没把我们的 semver 承诺当作承重的。在这之前:

**每个 changeset 的默认是 `patch`。**

仅在有刻意、有据可查的理由时用 `minor`:
- 一个新的顶层 MCP 工具名(在 Agent 的工具列表中可见)
- 一个新的 package export 期望下游代码 import
- 一个新的 opt-in feature flag,带有据可查的用户可见行为

仅在以下情况用 `major`:
- 破坏一个有据可查的公共 API(函数签名、MCP 工具名、导出类型)
- 移除一个用户已被告知可依赖的功能

**其他一切——内部重构、UX 打磨、bug 修复、新内部 helper、纯文档改动、性能、安全加固、下游无需 opt-in 的新增 schema 字段——都是 `patch`。** 即便它在代码行数上是个大补丁,*契约*没有变。

## linked 组的放大器

因为所有 linked 包 bump 到同一版本,对 `@harness-fe/mcp-server` 一个 `minor` 标记的 changeset 会让**所有** linked 包小升级一格——即便其中那些零改动也跟着发。用户看到"10 个包从 3.0 → 3.1",就以为有旗舰功能,但其实只是个按钮。

所以:**默认 `patch`。如果你真的需要 `minor`,把 changeset 描述当作 release note 来写,因为用户读的就是那个。**

## 提交 changeset 前的决策清单

按顺序问自己:

1. **我重命名、移除或改了一个 exported API、MCP 工具或稳定公共类型的调用形状吗?** → `major`
2. **我加了一个新 export,文档里告诉用户调它了吗?** → `minor`
3. **否则(绝大多数变更)** → `patch`

不要因为 PR 感觉重要就去 reach `minor`。重要性通过 PR body 和 changelog 传达。版本号只是关于兼容性的契约。

## 怎么把 pending changeset 降级

如果你开了一个 `minor` PR,反思后应该是 `patch`,在分支上改 changeset frontmatter 就行:

```diff
--- a/.changeset/my-thing.md
+++ b/.changeset/my-thing.md
@@ -1,3 +1,3 @@
 ---
-'@harness-fe/runtime': minor
+'@harness-fe/runtime': patch
 ---
```

push,最终的 Version Packages PR 会反映新的级别。

## 跨包工作协调

当单个 PR 真的触多个 linked 包(比如为新帧 schema 一起改 `protocol` + `mcp-server`)时,放**一个命名两者的 changeset**:

```markdown
---
'@harness-fe/protocol': patch
'@harness-fe/mcp-server': patch
---
```

不要为同一个逻辑变更拆成多个 changeset 文件——changeset 在 release 时合并,但用一段话描述一个用户可见的事情,changelog 读起来更清爽。

## 命中 1.0 / 公开 launch 后

本文档会变得更严:
- 移到**严格 semver**:任何新增 export 是 `minor`,任何移除是 `major`
- 考虑解 linked,让独立的包按自己节奏发
- 在 GitHub Releases 上给 release 打 release note(已在 `.github/workflows/release.yml` 启用)

现在(pre-launch),倾向于慢的版本变动。一旦有用户在看,我们可以更频繁地发布。

## Node 版本:docs vs `engines`(故意的差距)

对外文档(README badge、README 前置、CONTRIBUTING、`docs/quickstart.md`)写 **Node ≥ 20**。`packages/mcp-server/package.json` 的 `engines` 字段保持 **`>=18`**。

这是刻意的,不是漂移:

- **代码现实**:任何地方都没用 Node 20 才有的 API。Node 18 跑 daemon 和每个适配都正常。(验证:`grep -rn "import.meta.resolve\|node:test" packages/*/src` → 0 命中。)
- **文档推荐 20**:Node 18 于 2025-04 EOL——2026 年还跑它意味着没有安全补丁。我们推荐当前 LTS。
- **`engines: ">=18"` 执行**:保持宽松避免一脚踹掉还在 18 的用户。他们从包管理器拿到 EOL 警告,而不是被我们硬安装失败。

**别"修"这个差距把它们对齐。** 把 `engines` bump 到 `>=20` 零技术正确性增益,只会让本来能成功跑 daemon 的用户挫败。等真的需要 Node 20 only 的特性时再重新评估。
