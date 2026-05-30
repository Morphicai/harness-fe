/**
 * Scope-based access control (5.0 · P6 · C4) — a deliberately simple mapping
 * over the three fixed scopes, instead of a general policy engine (Casbin) that
 * would be overkill for control/read/write.
 *
 * - `control` → mutating page.* commands (protocol's CONTROL_COMMANDS)
 * - `read`    → everything else an agent calls (*.tail, project.*, session.*,
 *               tasks.*, screenshots, dom queries, …)
 * - `write`   → event reporting by the runtime client; agents never need it,
 *               so it grants nothing through the gateway's tool path.
 */
import { CONTROL_COMMANDS } from '@harness-fe/protocol';
import type { Scope } from './store.js';

/** The scope a tool call requires. */
export function requiredScope(tool: string): Scope {
    return CONTROL_COMMANDS.has(tool) ? 'control' : 'read';
}

/** Whether a caller holding `scopes` may invoke `tool`. */
export function allowsTool(scopes: readonly Scope[], tool: string): boolean {
    return scopes.includes(requiredScope(tool));
}

interface ManifestTool {
    name?: unknown;
    [k: string]: unknown;
}

/**
 * Dynamic manifest: drop tools the caller has no scope for from a `tools/list`
 * result, so an agent without `control` never even sees page.* in its toolset.
 * Mutates/returns the same result object shape; tolerant of unexpected shapes.
 */
export function filterManifest<T extends { tools?: unknown }>(result: T, scopes: readonly Scope[]): T {
    if (result && Array.isArray(result.tools)) {
        result.tools = (result.tools as ManifestTool[]).filter(
            (t) => typeof t?.name !== 'string' || allowsTool(scopes, t.name as string),
        );
    }
    return result;
}
