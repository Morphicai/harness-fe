/**
 * @harness-fe/core — the transport-agnostic backend.
 *
 * A pure library: capability API + bridge (PeerSocket-based) + store +
 * identity/visibility. No HTTP/WS server; the gateway owns the front door and
 * drives core through {@link CoreClient}.
 */

// Identity model + visibility
export {
    type Principal,
    type PrincipalKind,
    type PrincipalScopes,
    LOCAL_PRINCIPAL,
    HOST_PRINCIPAL,
    tokenPrincipalId,
    principalCan,
    canSee,
    canSeeProject,
    projectGrant,
    FORWARDED_CALLER_HEADER,
    FORWARDED_PROJECTS_HEADER,
} from './identity.js';

// Caller context (ambient principal across async boundaries)
export { runWithCaller, currentCaller } from './callerContext.js';

// Session routing
export { SessionRouter, type PeerSession } from './sessionRouter.js';

// Bridge (transport-agnostic) + transport abstraction
export {
    Bridge,
    defaultDataDir,
    type PeerSocket,
    type BridgeOptions,
    type SendCommandOptions,
    type EventListener,
} from './bridge.js';

// Capability API
export {
    CoreCapabilities,
    ScopeDeniedError,
    requiredScopeForCommand,
    assertScope,
    type CapabilityScope,
    type CommandOptions,
} from './capability/index.js';

// CoreClient (the gateway's dependency)
export {
    type CoreClient,
    InProcessCoreClient,
    createCoreClient,
} from './coreClient.js';

// Replay export creation + visitor timeline (used by capability + gateway)
export { createReplayExport } from './replayCreate.js';
export { buildVisitorTimeline } from './visitorTimeline.js';

// Store
export * from './store/index.js';
