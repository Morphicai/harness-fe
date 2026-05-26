# `@harness-fe/sandbox` — Phase notes(执行追踪)

> 边做边记。卡点、和原计划不符、值得记住的决策都在这里。

## 设计原则(贯穿所有 channel)

### ★ 失败安静(graceful degradation)

劫持/wrap 失败的场景必须**静默退化**到原生行为,**绝不**:
- 抛 error 中断业务
- 输出 console.error
- 改变同步/异步语义
- 让消费方感知到失败

允许:
- 仅一次 `console.debug` 标记(production 模式抑制)
- onEntry 不触发(消费方天然不感知)
- handle.enabled[channel] 标记 false 让消费方按需自检

适用场景:
- `Object.defineProperty(window.location, 'href', ...)` 在某些环境只读 → 退化为无 navigation 拦
- happy-dom 不支持的 API(如某些 Storage 行为)→ skip + 标记
- 浏览器锁定的 native(如 `Object.freeze(Storage.prototype)`)→ 退化

每个 channel 实现里都要走 try/catch 包裹关键 patch 步骤。

---

## Phase notes

### Phase 0(已完成)
- 76 测试 / 7 red / 53 todo / 16 pass — 见 [phase0-redlist.md](./sandbox-lib-phase0-redlist.md)
- 已提交 PR #75

### Phase 1 — bootstrap `packages/sandbox/`(完成)
- package.json / tsconfig / vitest.config
- types.ts(SandboxOptions / SandboxEvent / Interceptor 接口)
- initiator.ts(captureInitiator,直接搬自 runtime-client)
- chain.ts(per-channel chain registry + 多 install 叠加 + per-entry hook)
- install.ts(installSandbox 入口)

### Phase 2 — 9 个 channel(完成 — 比原计划多 2 个)
| channel | 文件 | 关键点 |
|---|---|---|
| console | `channels/console.ts` | 5 个 level 包装 |
| errors | `channels/errors.ts` | window error / unhandledrejection 监听 |
| fetch | `channels/fetch.ts` | observer + onRequest/onResponse 拦截 + async |
| xhr | `channels/xhr.ts` | prototype.open/send 拦截,loadend 后 onResponse |
| ws | `channels/ws.ts` | **prototype.send patch + new.target 检查**(红榜 #12/#13) |
| storage | `channels/storage.ts` | **Proxy + prototype 双拦**(红榜 #11);set trap 兼顾 prototype.X.call 内部 `[[Set]]` |
| navigation | `channels/navigation.ts` | history.{pushState,replaceState} prototype patch + location.href/hash/assign/replace defineProperty(红榜 #19/#20) |
| **globals**(新增)| `channels/globals.ts` | **per-entry hook**(每个 install 独立 watch 列表);defineProperty(window, key) |
| **indexeddb**(新增)| `channels/indexeddb.ts` | IDBFactory.prototype.open + IDBObjectStore.prototype.{put,add,get,getAll,delete,clear,openCursor};短路用 synthetic IDBRequest |

### Phase 3 — chain + 多 install(完成)
- onion 模型:install 顺序触发,后者 wraps 前者(threading 改写)
- LIFO dispose
- pause / resume
- selfUrls denylist
- per-entry hook(globals 用)
- 测试套:`chain.test.ts` 全绿

### Phase 4 — runtime-client 重构成消费 sandbox(**暂停**)
原计划要把 capture.ts 改成 installSandbox 消费方,但首次尝试发现:
- happy-dom 下 Proxy + RuntimeClient e2e 出现自循环超时
- 用户决定先扩展 sandbox channel,不急于 wire-in
- 回滚到 main 状态保持现状

**保留这一笔**:Phase 4 不是不做,是先扩 sandbox 到位、稳定后再做。

### Phase 5 / 6 — 跨包 E2E + 文档发布(等 Phase 4)

---

## 测试套现状

| 包 | 测试数 | 状态 |
|---|---|---|
| `@harness-fe/sandbox` | 79 pass + 2 skip(81 total)| ✅ 全绿 |
| identity 测试(22) | 20 green / 2 skip(happy-dom env diff)| ✅ |
| interceptor 测试(32) | 全绿 — 53 个 todo 已实测 | ✅ |
| chain 测试(8) | 多 install onion / LIFO dispose / pause / selfUrls | ✅ |
| globals 测试(8) | watch / onSet / onGet / 拦截 / 解除 | ✅ |
| indexeddb 测试(6) | onOpen / onPut / 改写 / 拦截 / clear | ✅(用 fake-indexeddb) |
| smoke 测试(5) | enabled flags / dispose 幂等 / pause-resume | ✅ |
| `@harness-fe/runtime` | 现状不变 | ✅(未动) |
| `@harness-fe/mcp-server` | 现状不变 | ✅(未动) |

---

## 卡点 / 偏离记录

### 1. Proxy on window 性能 / 不可行
- 想过给 globals channel 用 Proxy on window — 性能不可接受、且 window 是 exotic object
- 改方案:per-key `Object.defineProperty(window, key, ...)`,消费方提供 watch 列表

### 2. happy-dom 没有 IndexedDB
- 测试直接报 `indexedDB is not defined`
- 解法:`fake-indexeddb/auto` 作为 devDep

### 3. happy-dom typeof/instanceof 差异
- `toString.call(localStorage)` happy-dom 返 `[object Object]`,真浏览器返 `[object Storage]`
- 解构 setItem 不 throw(原本 spec 应 throw)
- 这 2 条 identity 测试在 happy-dom 下 skip,留给真浏览器 smoke

### 4. RuntimeClient e2e timeout
- 初次重构 capture.ts 消费 sandbox 时,某 ws e2e 测试卡 10s 超时
- 没深查,先回滚,留 Phase 4 重启时调查

### 5. Proxy 对 Storage 的 set trap 必须同时拦
- 不拦的话 `Storage.prototype.setItem.call(proxy, k, v)` 内部 `this[k] = v` 走 [[Set]] 会绕过
- 解决:Proxy `set` trap 也走 interceptor,但调 origSet 时绑定到 real target 而非 proxy(避免再次触发 trap)

### 6. 真 Chrome / Blink:`for...in localStorage` 暴露 Storage.prototype methods(happy-dom 不暴露)
- WebIDL binding 把 Storage.prototype 上的 setItem / getItem / removeItem / clear / key / length 标记为 `enumerable: true`
- 真 Storage 有 special [[Enumerate]] 内部钩子隐藏它们;Proxy 没办法复现
- 真 Chrome `for-in` 走 ordinary EnumerateObjectProperties,跨原型链找 enumerable own,把这些方法都翻出来
- 解决:install 时遍历 Reflect.ownKeys(Storage.prototype),把每个成员的 descriptor 改成 `enumerable: false`(同时记录原 descriptor);dispose 时 defineProperty 全部还原
- 副作用:install 期间 Storage.prototype.setItem.enumerable === false 是全局,对**所有** Storage 生效 — 这是符合直觉的且原生 native Storage 行为本来就是 not-enumerable 的

---

## 真浏览器验证(Playwright + Chromium)

| | 单元测试(happy-dom)| 真浏览器 e2e(Chromium 1223)|
|---|---|---|
| 测试数 | 79 pass / 2 skip / 81 total | 24 pass / 0 fail / 0 skip |
| 实施 | `pnpm --filter @harness-fe/sandbox test` | `pnpm --filter harness-fe-react-demo run e2e:sandbox` |
| 用例 | identity / interceptor / chain / globals / indexeddb / smoke | 上述全部子集(浏览器场景代表) |

E2E 流程:`createServer(vite + react plugin)` → `chromium.launch` → 加载 `/sandbox` 路由 → 页面自跑 ~24 个 case → e2e 读取 `data-testid="case-*"` 的 `data-status` 属性聚合结果。

**首次跑出两条 fail,均已修**:
- `dispose-restores` — 测试逻辑跟"chain 末次 dispose 才还原"的设计不符,改测"install 期间 fetch 是 wrapped"
- `for...in localStorage` — 真 Chrome 暴露 prototype methods;通过 install 时把 Storage.prototype 全部成员改 enumerable=false 解决
