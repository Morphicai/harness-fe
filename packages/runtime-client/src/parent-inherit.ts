/**
 * Same-origin iframe identity inheritance.
 *
 * Extracted from `client.ts` so unit tests don't have to load the rrweb
 * recorder (rrweb has a CJS/ESM dual-shape that breaks happy-dom test envs).
 */

export interface ParentInheritance {
    tabId?: string;
    sessionId?: string;
    parentProjectId?: string;
}

const TAB_ID_KEY = '__hfe_tab_id__';

/**
 * Reach across to a same-origin parent window to inherit the harnessa-fe
 * identity triple (tabId, sessionId, parentProjectId). Cross-origin parents
 * throw on property access; we catch and return {} so the child runtime
 * silently falls back to generating its own ids.
 *
 * Resolution order for each field:
 *   tabId            ← parent.__harnessa_fe_client__.tabId
 *                    ← parent.sessionStorage.getItem('__hfe_tab_id__')
 *   sessionId        ← parent.__hfe_session_id__
 *                    ← parent.__harnessa_fe_client__.sessionId
 *   parentProjectId  ← parent.__HARNESSA_FE__.projectId
 */
export function tryInheritFromParent(): ParentInheritance {
    if (typeof window === 'undefined') return {};
    if (window.parent === window) return {};
    try {
        const p = window.parent as Window & {
            __hfe_session_id__?: string;
            __harnessa_fe_client__?: { tabId?: string; sessionId?: string };
            __HARNESSA_FE__?: { projectId?: string };
        };
        const parentTabId =
            p.__harnessa_fe_client__?.tabId ??
            p.sessionStorage?.getItem(TAB_ID_KEY) ??
            undefined;
        const parentSessionId =
            p.__hfe_session_id__ ??
            p.__harnessa_fe_client__?.sessionId ??
            undefined;
        return {
            tabId: parentTabId ?? undefined,
            sessionId: parentSessionId ?? undefined,
            parentProjectId: p.__HARNESSA_FE__?.projectId,
        };
    } catch {
        return {};
    }
}
