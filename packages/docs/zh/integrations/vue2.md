# 在遗留 Vue 项目中采用 harness-fe

本文针对非纯 Vue 3 的代码库——`@vue/compat`、迁移进行中的项目、大型 iView/Element/Ant Design fork,以及任何还会出现 filter 语法(`{{ x | foo }}`)或 `<template functional>` 的项目。

## 契约

> harness-fe 永远不会产出让 vue-loader / @vitejs/plugin-vue 报错的输出。最坏情况是某个 `.vue` 文件未插桩,原样通过。

如果你看到只有装了插件才出现的 vue-loader / compiler 错误,把它当作 harness-fe 的 bug 上报。

## 这是怎么保证的

Vue SFC transformer 走三道独立的安全层(`packages/unplugin/src/vue-transform.ts`):

1. **严格 parse 降级**。任何 `@vue/compiler-sfc` 错误 → 跳过该文件(不注入)。我们不信任来自半恢复 parse 的偏移量。
2. **walk 期异常捕获**。AST 遍历在 try/catch 中运行。任何抛出的错误 → 跳过,不注入。
3. **输出自检(`safeMode`)**。注入属性后,我们重新 parse 产出的源代码。如果 reparse 浮现错误 → 撤销注入,回退到原始源。

三道都会通过 `console.warn` 透出,这样你能看到哪些被跳过、为什么。

## Vue 2 模式对插件来说什么样

| 模式 | 行为 |
|---|---|
| `{{ value \| filter }}`(filter) | 通常被跳过(Vue 3 的 compiler-dom 不识别 filter) |
| `<template functional>` | 通常被跳过 |
| `slot="x"` / `slot-scope` | parse 通过;元素仍然拿到 `data-morphix-loc` |
| `v-bind.sync` 修饰符 | parse 通过(`.sync` 对 parser 只是属性名) |
| `v-on.native` | parse 通过 |
| `inline-template` | 宿主元素被打标;嵌套 template 内容不 parse |
| `<template v-for>` 上的 `key` | parse 通过 |
| `<script>` 中的 render functions / JSX | 该 transformer 看不见(按设计如此) |

## 设置

```ts
harnessFE({
  // ...
  safeMode: true, // 默认——对任何含 Vue 2 时代代码的项目都保持打开
})
```

只有在你测过性能开销并确认你的项目 100% 是现代 Vue 3 语法后,才传 `safeMode: false`。这个检查是每文件多一次 `parseSFC` 调用,冷启动时每个 `.vue` 多几毫秒。

## Dry-run 覆盖率报告

在大型遗留代码库上正式开插件前,先 dry-run 看一下到底有多少文件能拿到 `data-morphix-loc`:

```bash
HARNESS_FE_DRY_RUN=1 pnpm dev
```

dev server 退出(Ctrl-C)时,插件在 stderr 上打印报告:

```
[harness-fe] Vue transform coverage report
  files attempted:        1247
  files injected:         1102
  elements tagged:        18430
  skipped (SFC error):    14
  skipped (template):     112
  skipped (walk error):   0
  skipped (self-check):   19
  first 20 skipped paths:
    src/legacy/Search.vue
    src/legacy/UserCard.vue
    ...
```

可以用它来:

- 判断 Agent 的源码感知特性是否值得做转换工作(例如 < 5% 缺失 → 上;> 30% → 考虑先把 filter 迁掉)。
- 建一个优先现代化的文件清单。

## 别忘了 runtime-only 模式

如果连部分覆盖都不够——比如依赖 `project_where_is` 的 Agent 工具会太不可靠——你可以只装运行时客户端,跳过构建插件。仍然能用到 `console_tail` / `network_tail` / `errors_tail` / `session.recordings`,这些本来就是价值最高的能力,而且对构建零风险。

## 报告问题

发现某个 Vue 2 模式破坏了下游时,附上:

1. 一个能复现的最小 `.vue`。
2. daemon 上确切的 `console.warn` 行。
3. 你的 `@vue/compiler-sfc` 版本(`pnpm why @vue/compiler-sfc`)。

这三样足以在 `vue-transform.test.ts` 中加一个回归用例。
