/**
 * HTTP POST /events handler — stateless alternative to the WebSocket path.
 *
 * Accepts a JSON body matching `httpBatchSchema`:
 *   { hello: { role: 'node-runtime', projectId, sessionId, ... },
 *     events: [ { id, name, ts, payload, ... }, ... ] }
 *
 * Each POST is treated as a one-shot hello+events sequence:
 *   1. Register (or re-register) the peer via the same bridge internals.
 *   2. Persist every event to the right session timeline.
 *   3. Respond 204 No Content.
 *
 * Also handles:
 *   GET /events/ping  → 200 { ok: true, version }
 *   OPTIONS /events   → 204 CORS preflight
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, httpBatchSchema } from '@harnessa-fe/protocol';
import type { Bridge } from './bridge.js';

// ─── CORS helpers ────────────────────────────────────────────────────────────

function isLoopback(req: IncomingMessage): boolean {
    const host = req.headers['host'] ?? '';
    // Match 127.0.0.1:* and localhost:*
    return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host);
}

function setCorsHeaders(res: ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

// ─── Body reader ─────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Returns a handler that matches /events/* routes and returns `true` when it
 * handled the request (so the bridge can short-circuit its 404 fallback).
 */
export function createEventsHandler(
    bridge: Bridge,
): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
    return async (req, res): Promise<boolean> => {
        const url = req.url ?? '';
        const method = req.method ?? 'GET';

        // Only intercept /events and /events/ping
        if (url !== '/events' && url !== '/events/ping') return false;

        // CORS: only emit headers when request comes from loopback
        if (isLoopback(req)) {
            setCorsHeaders(res);
        }

        // Preflight for both routes
        if (method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return true;
        }

        // GET /events/ping
        if (url === '/events/ping' && method === 'GET') {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION }));
            return true;
        }

        // POST /events
        if (url === '/events' && method === 'POST') {
            let rawBody: string;
            try {
                rawBody = await readBody(req);
            } catch {
                res.statusCode = 400;
                res.setHeader('content-type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'failed to read request body' }));
                return true;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(rawBody);
            } catch {
                res.statusCode = 400;
                res.setHeader('content-type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: 'invalid JSON' }));
                return true;
            }

            const validated = httpBatchSchema.safeParse(parsed);
            if (!validated.success) {
                res.statusCode = 400;
                res.setHeader('content-type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({ error: validated.error.message }));
                return true;
            }

            const { hello, events } = validated.data;

            try {
                bridge.handleHttpBatch(hello, events);
            } catch (err) {
                res.statusCode = 500;
                res.setHeader('content-type', 'application/json; charset=utf-8');
                res.end(JSON.stringify({
                    error: err instanceof Error ? err.message : 'internal error',
                }));
                return true;
            }

            res.statusCode = 204;
            res.end();
            return true;
        }

        return false;
    };
}

export type EventsHandler = ReturnType<typeof createEventsHandler>;
