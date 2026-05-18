# @harnessa-fe/protocol

> Shared types + Zod schemas for [Harnessa-FE](https://github.com/morphixai/harnessa-fe). Internal package — every other Harnessa-FE package depends on this.

You normally do **not** install this directly. It is hoisted as a transitive dependency of `@harnessa-fe/vite`, `.webpack`, `.runtime`, and `.mcp-server`.

## What's inside

- Wire-format message types (`HelloFrame`, `EventFrame`, `CommandFrame`, …)
- Zod schemas for runtime validation
- Selector grammar for DOM queries
- Shared result types

```ts
import {
    PROTOCOL_VERSION,
    DEFAULT_WS_PORT,
    EventFrameSchema,
} from '@harnessa-fe/protocol';
```

## Stability

Pre-1.0. Wire format may change between minor versions. Pin exact versions in production until 1.0.

## Docs

- [Root README](https://github.com/morphixai/harnessa-fe#readme)
- [Architecture](https://github.com/morphixai/harnessa-fe/blob/main/ARCHITECTURE.md)

## License

MIT
