/**
 * @harness-fe/sandbox — browser sandbox + interceptor lib.
 *
 * Single entry point. Importing the package activates lazy patch installers
 * for every channel; the patches don't engage until `installSandbox()` is
 * actually called.
 */

export { installSandbox } from './install.js';
export type {
    SandboxOptions,
    SandboxHandle,
    SandboxEvent,
    SandboxCtx,
    SandboxChannel,
    Initiator,
    // Channel-specific observations
    FetchReqObservation,
    FetchResObservation,
    FetchSseFrameObservation,
    XhrReqObservation,
    XhrResObservation,
    WsObservation,
    StorageObservation,
    NavigationObservation,
    ConsoleObservation,
    ErrorObservation,
    GlobalsObservation,
    IndexedDbObservation,
    // Interceptor shapes
    FetchInterceptor,
    XhrInterceptor,
    WsInterceptor,
    StorageInterceptor,
    NavigationInterceptor,
    GlobalsInterceptor,
    IndexedDbInterceptor,
    InterceptResult,
    ModuleAttribution,
} from './types.js';
export { captureInitiator } from './initiator.js';
