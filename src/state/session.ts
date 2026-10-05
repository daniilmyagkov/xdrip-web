/**
 * Which Nightscout this browser talks to. Stored only on this device (localStorage).
 *
 * Onboarding link (shown as a QR code by the master app):
 *   https://<site>/#connect=<base64url(JSON {u: nightscoutUrl, t: token})>
 * The fragment never reaches any web server, so the token is not leaked to the hosting.
 */
import { normaliseBaseUrl, type Connection } from '../ns/client';

const KEY = 'xdripweb.connection.v1';

export function loadConnection(): Connection | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Connection>;
    return c.baseUrl ? { baseUrl: c.baseUrl, token: c.token ?? '' } : null;
  } catch {
    return null;
  }
}

export function saveConnection(c: Connection): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // private mode: the session lasts until the tab closes
  }
}

export function clearConnection(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
}

export function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Reads a connection from the page's #connect=… fragment (and removes it from the address bar). */
export function connectionFromLocation(loc: Location = window.location): Connection | null {
  const m = /(?:^#|&)connect=([A-Za-z0-9_-]+)/.exec(loc.hash);
  if (!m?.[1]) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(m[1])) as { u?: string; t?: string };
    if (!parsed.u) return null;
    history.replaceState(null, '', loc.pathname + loc.search);
    return { baseUrl: normaliseBaseUrl(parsed.u), token: (parsed.t ?? '').trim() };
  } catch {
    return null;
  }
}
