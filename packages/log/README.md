# @harnessa-fe/log

Isomorphic structured logger for Harnessa-FE. The same `import { log } from '@harnessa-fe/log'` works in **Server Components, Route Handlers, Server Actions, and Client Components** — every event lands in the same `sessions/{sid}/timeline.jsonl` on the daemon.

```bash
pnpm add @harnessa-fe/log
```

You also need at least one runtime SDK installed:
- Browser only → `@harnessa-fe/runtime`
- Server only → `@harnessa-fe/node-runtime`
- Both (typical Next.js) → both

If neither is installed `log` is a no-op — calls never throw.

## Usage

```ts
import { log } from '@harnessa-fe/log';

log.info('Page loaded');
log.warn('Cart total exceeds threshold', { total, limit });
log.error('Stripe webhook failed', err);
log.debug('Cache hit', { key, ttl });

// Scope chain — prefixes every event with `scope=cart.checkout`
const cartLog = log.scope('cart').scope('checkout');
cartLog.info('Submitting order', { items: items.length });
```

The last argument can be a plain object — it's treated as structured metadata; everything before it joins as the message.

### Variadic + meta

```ts
log.info('user', userId, 'clicked', { button: 'buy' });
// → message: "user u_123 clicked", meta: { button: 'buy' }
```

## Where do events land?

Every `log.*` call emits a `t: 'app-log'` row to the daemon's session timeline (`~/.harnessa/data/sessions/{sessionId}/timeline.jsonl`). The row carries:

| Field | Source |
|---|---|
| `sessionId` | Browser: from the runtime client. Server: from `node-runtime.getRequestSessionId()` → ALS → adapter provider → undefined |
| `projectId` / `buildId` | Stamped by the daemon from peer registration |
| `level` | `'debug' \| 'info' \| 'warn' \| 'error'` |
| `args` | Variadic args passed to the log call |
| `scope` | Dot-joined scope chain, if any |
| `ts` | Unix ms, captured at call site |

Agents tell `app-log` apart from auto-captured `server-log` / browser `console` events, so you can ask things like "show me all `log.warn(...)` from the cart scope in this session".

## sessionId continuity

The defining property of this logger: **two `log.info()` calls under the same page-load — one from a Server Component, one from a Client Component — emit with the same `sessionId`**.

This is what makes timelines coherent. The mechanism:

- **Browser**: reads `window.__harnessa_fe_client__.sessionId`, set by `@harnessa-fe/runtime` after it adopts the SSR seed
- **Server**: delegates to `@harnessa-fe/node-runtime.getRequestSessionId()`, which walks:
  1. `AsyncLocalStorage` (populated by `withHarnessaTracing(handler)`)
  2. Adapter-supplied provider (Next pushes a React `cache()`-backed getter via `setSessionIdProvider`)
  3. `undefined` → orphan event filed under `sessions/server-orphans/`

Orphans are correct, not a bug — a `log.info()` from a background timer or cold-start init has no request to belong to. Better orphaned than misattributed to whatever request happened to be in flight.

## Concurrency safety

`log` is safe under concurrent requests. The server `sessionId` is **read fresh at emit time, not closed over at the import site**. Two tabs hitting the same Next process at the same time get their own React `cache()` scope; their `log.*` rows go to separate session timelines with zero cross-contamination.

This is verified by `@harnessa-fe/node-runtime`'s test suite — 28 cases including a `Promise.all([renderA, renderB])` with interleaved `console.log` and explicit assertions.

## What's NOT in the payload

By design, `log` does **not** include `userId` in the event payload. The link from session to user is held by the daemon's visitor index (`sessionId → SessionMeta.participants → visitor.userId`) — agents do one lookup if they need it. Trade-off: one extra index hit instead of any chance of cross-request user leakage.

## API

```ts
interface Logger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    log(...args: unknown[]): void;     // alias of info
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    scope(name: string): Logger;        // returns a new prefixed logger
}

export const log: Logger;
```

## Production behavior

`log` is gated by the runtime SDK it dispatches to — `@harnessa-fe/runtime` and `@harnessa-fe/node-runtime` are both `NODE_ENV === 'development'` only. In production builds `log.*` becomes a cheap no-op (no network, no writes).

## License

MIT
