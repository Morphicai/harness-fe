# `@harness-fe/sandbox` — Phase 0 红榜(refactor 规格说明)

> **Phase 0 输出物**:把"重构后应该有的行为"写成 76 个测试,跑在**当前 `@harness-fe/runtime`** 上。**通过的 = 必须保留不破坏的现有正确性;失败的 = refactor 必修;todo 的 = refactor 必须新增的能力**。

测试文件:
- `packages/runtime-client/src/identity.spec.test.ts` — 22 用例(typeof / instanceof / 边界行为)
- `packages/runtime-client/src/interceptor.contract.test.ts` — 41 用例(interceptor API,全部 `.todo`)
- `packages/runtime-client/src/chain.contract.test.ts` — 13 用例(多 install 叠加,11 个 `.todo`)

---

## 统计

| 状态 | 数量 | 意义 |
|---|---|---|
| ✅ Pass(15) | 16 | 现有实现就做对了,refactor 不能破坏 |
| ❌ Fail(red) | 7 | 当前实现 fail — refactor 必修 |
| 📋 Todo | 53 | API 还不存在 — refactor 必须新增 |
| **合计** | **76** | 全部 = sandbox lib 的 acceptance criteria |

---

## 🔴 红榜 7 条(refactor 必修)

| # | 用例 | 当前为什么 fail | 修复方向 |
|---|---|---|---|
| #8 | `Object.prototype.toString.call(localStorage) === '[object Storage]'` | happy-dom 行为差异(原生浏览器返回 `[object Storage]`)— 这条**部分是测试环境问题**,但 Proxy 必须不破坏 `Symbol.toStringTag` 透传 | 用 Proxy 时不 trap `Symbol.toStringTag`,默认透传给 target |
| #11 | `Storage.prototype.setItem.call(localStorage, k, v)` 不触发 interceptor | 当前用 `Object.defineProperty(storage, 'setItem', ...)` 加 own property — 直接调 prototype 方法绕过 own property | **Proxy `set` trap + `Storage.prototype.setItem` 双层 patch**(任一路径都能拦) |
| #12 | `WebSocket.prototype.send.call(ws, data)` 不触发 interceptor | 当前 `ws.send = wrapper` 在实例上 — prototype 调用绕过 | **patch `WebSocket.prototype.send`**(替代 instance own property) |
| #13 | `WebSocket('wss://x')` 不加 `new` 不报错 | `function PatchedWebSocket` 没检查 `new.target` | constructor 入口加 `if (!new.target) throw new TypeError(...)` |
| #17 | 解构 `const { setItem } = localStorage; setItem(...)` 不抛错 | happy-dom 不强制 `this` 是 Storage 实例 — **环境问题** | 真实浏览器自然过,标记为 `it.skipIf(happyDOM)`,真浏览器 smoke 测一次 |
| #19 | `location.href = '/foo'` 没触发 navigation observer | 当前**无 navigation channel** | 新增 `src/channels/navigation.ts`,via `Object.defineProperty(window.location, 'href', { set })` |
| #20 | `history.pushState(...)` 没触发 navigation observer | 同上 | Proxy `window.history` 或 patch `History.prototype.pushState` / `replaceState` |

**实质上是 5 类必修**:
1. Storage `.call()` 绕过 → Proxy + prototype 双拦
2. WebSocket `.call()` 绕过 → prototype.send patch
3. WebSocket new.target 检查
4. navigation channel(全新)
5. Symbol.toStringTag 透传(Proxy 默认行为即可)

---

## 📋 Todo 53 条(refactor 必新增)

按 channel + 横切:

### fetch(9 条 todo)
- `onRequest` 改写 url / headers / body / 短路 / abort
- `onResponse` 改写 status / headers / body / 短路
- `async onRequest` 等待
- observer 看到的是 interceptor 后的最终值

### xhr(4 条)
- `onRequest` 改写 url / headers
- `onResponse` 改写 responseText / status

### ws(7 条)
- `onConstruct` 改写 url / 短路成 stub
- `onSend` drop / rewrite
- `onMessage` drop / rewrite
- `onClose` observe

### storage(8 条)
- `onSet` block / rewrite key / rewrite value
- `onRemove` block
- `onClear` block
- `onGet` override
- cookie 走同一接口
- **Storage.prototype.setItem.call 也走 interceptor**(跟 #11 一致)

### navigation(8 条)
- `onPush` / `onReplace` block + rewrite
- `onAssign` 拦 `location.href` setter / `assign()` / `replace()`
- `onHash` 拦 `location.hash` setter
- `popstate` / `hashchange` observe-only

### console / errors(3 条)
- 已经有,验证不破坏

### ctx 横切(3 条)
- `ctx.initiator.stack` 每个 interceptor 都有
- `ctx.channel` + `ctx.kind`
- `ctx.moduleId` 字段定义(本期永远 undefined,future build plugin 用)

### Chain(11 条 todo,1 pass)
- ✅ idempotent 现有行为已对(同一个 install 第二次 no-op)
- 多 install 叠加 onion
- LIFO dispose / 非 LIFO 时 warn
- selectable channels
- pause / resume
- selfUrls denylist

---

## ✅ Pass 16 条(必须保留)

这些是已有正确性,refactor 后必须依然 pass:

| # | 用例 | 含义 |
|---|---|---|
| 1-4 | typeof fetch/WebSocket/localStorage/setItem | 类型透明性 |
| 5 | `new WebSocket() instanceof WebSocket` | prototype 链对 |
| 6-7 | localStorage instanceof Storage + 实例 memoize | identity 稳定 |
| 9-10 | constructor + prototype 链 | identity 链 |
| 14-16 | for...in / ownKeys / JSON.stringify 不被污染 | 枚举透明 |
| 18 | `setItem.bind(localStorage)` 仍走 interceptor | 实例 patch 路径 |
| 21 | `class X extends WebSocket` works | 子类化 |
| 22 | dispose 后 fetch/setItem 还原 | LIFO 还原(部分) |
| Chain idempotent | 同一个 install 第二次 no-op | 现有行为 |

---

## Refactor 验收(Phase 5)

Phase 1-4 完成后,跑这套 76 测试 + 现有所有测试,**必须全部转绿(7 红 → 0 红、53 todo → 53 it)**。

外加新增测试(Phase 1+):
- sandbox 包内部 channel 单元测试(每个 channel ~10 个)
- chain.test.ts 实测多 install onion
- dispose.test.ts 实测 LIFO

**最终目标**:Phase 0 的 76 用例 100% pass + sandbox 包新增 ~100 测试 100% pass + 现有 392 用例 0 回归。

---

## 当下不动

- ❌ Build plugin(`@harness-fe/sandbox-plugin-vite|webpack`) — 当 module attribution 真有需求再做
- ❌ 下游微前端基座 / MorphixAI 基座实际接入 — lib 发布后由消费方做
- ❌ Worker / 跨源 iframe / ServiceWorker 沙箱传播

---

## 下一步

Phase 0 已完成,下一轮开 Phase 1:
1. bootstrap `packages/sandbox/`
2. 把 Phase 0 测试**搬到 sandbox 包**作为 acceptance criteria
3. 按 channel 实现,每完成一 channel 翻一组 todo 成实测
4. 红榜每修一条标记本文件
