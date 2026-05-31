/**
 * Capability scope enforcement.
 *
 * Every capability is either a `control` operation (mutating browser commands,
 * the protocol's CONTROL_COMMANDS) or a `read` operation (everything else an
 * agent calls — *.tail, project.*, session.*, tasks.*, memory.*, screenshots,
 * dom queries…). The `write` scope is the browser runtime client's event-report
 * channel and grants **no** capability — so a leaked write-only token can never
 * read or drive anyone's data.
 *
 * core enforces this on every capability call (defense in depth): the gateway
 * also trims its manifest by scope, but core is the authority that actually
 * gates the operation.
 */

import { CONTROL_COMMANDS } from '@harness-fe/protocol';
import { principalCan, type Principal, type PrincipalScopes } from '../identity.js';

export type CapabilityScope = Extract<keyof PrincipalScopes, 'read' | 'control'>;

/** The scope a browser command requires: control for mutating commands, else read. */
export function requiredScopeForCommand(command: string): CapabilityScope {
    return CONTROL_COMMANDS.has(command) ? 'control' : 'read';
}

/**
 * Thrown when a principal lacks the scope a capability requires. The gateway
 * maps this to the MCP `-32001 scope denied` response; in-process callers catch
 * it directly.
 */
export class ScopeDeniedError extends Error {
    readonly code = 'scope_denied';
    constructor(
        readonly principalId: string,
        readonly requiredScope: CapabilityScope,
    ) {
        super(`scope denied: principal "${principalId}" lacks "${requiredScope}" scope`);
        this.name = 'ScopeDeniedError';
    }
}

/** Assert the principal holds `scope`, else throw {@link ScopeDeniedError}. */
export function assertScope(principal: Principal, scope: CapabilityScope): void {
    if (!principalCan(principal, scope)) {
        throw new ScopeDeniedError(principal.id, scope);
    }
}
