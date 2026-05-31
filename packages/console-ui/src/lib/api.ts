/**
 * Governance fetch helpers (cookie-session auth).
 *
 * The data face (projects / sessions) reads through `hooks/useApi` (Bearer
 * token, with same-origin cookies along for the ride). These two helpers cover
 * the admin-only governance calls under `/admin/api/*`, which authenticate via
 * the admin session cookie set by POST /admin/login.
 */

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const resp = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    const raw = await resp.text();
    let parsed: unknown;
    try {
        parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
        parsed = undefined;
    }
    if (!resp.ok) {
        throw new Error((parsed as { error?: string } | undefined)?.error ?? `${resp.status} ${resp.statusText}`);
    }
    return parsed as T;
}

/** Submit the admin login form (sets the cookie). Throws on bad credentials. */
export async function adminLogin(username: string, password: string): Promise<void> {
    const body = new URLSearchParams({ username, password });
    const resp = await fetch('/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'manual',
    });
    // 303 redirect on success; 401 (with the login HTML) on failure.
    if (resp.status === 401) throw new Error('invalid credentials');
}
