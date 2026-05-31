/**
 * Console viewer credential — an **agent read token** the operator pastes on the
 * sign-in screen, kept in sessionStorage and sent as `Authorization: Bearer` on
 * every data-API call + the live WS handshake.
 *
 * Deliberately NOT read from the URL: the overlay's "open dashboard" link is a
 * pure navigation shortcut and carries no token, and a token in the address bar
 * leaks easily. The other way to view is an admin session (cookie) — see SignIn.
 */
const KEY = 'harness_console_token';

export function getToken(): string {
    if (typeof window === 'undefined') return '';
    try {
        return window.sessionStorage.getItem(KEY) ?? '';
    } catch {
        return '';
    }
}

export function setToken(token: string): void {
    try {
        if (token) window.sessionStorage.setItem(KEY, token);
        else window.sessionStorage.removeItem(KEY);
    } catch {
        /* sessionStorage unavailable — ignore */
    }
}

export function clearToken(): void {
    setToken('');
}

/**
 * WebSocket URL for the live `dashboard.update` feed: the gateway `/ws` on the
 * current host, carrying the read token (if any). Note: under the Governed
 * policy `/ws` requires a write token, so the operator's read token can't open
 * the live feed — the console falls back to manual refresh there.
 */
export function getWsUrl(): string {
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${proto}//${host}/ws${qs}`;
}
