/**
 * Local HTTP client for the Ecowitt gateway web API.
 *
 * Ported from the MIT `ecowitt_local` `api.py` (`EcowittLocalAPI`): a GET-based JSON client
 * against `http://<host>:<port>`, with optional base64-encoded-password auth via
 * `POST /set_login_info` and a single re-auth + retry on a 401/403. The undici dependency is
 * injected through a typed `FetchImpl` seam so callers (and tests) supply the transport without
 * any cast — the default seam wraps `undici.request`.
 */

import { request as undiciRequest } from 'undici';

const DEFAULT_PORT = 80;
const DEFAULT_TIMEOUT_MS = 30_000;
const AUTH_STATUSES = new Set([401, 403]);

/** Minimal response shape the client consumes (subset of undici's response). */
export interface FetchResponse {
  readonly statusCode: number;
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
}

/** Options the client passes to the transport. */
export interface FetchOptions {
  readonly method?: 'GET' | 'POST';
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

/** Typed transport seam — `undici.request`-compatible, no cast at the call sites. */
export type FetchImpl = (url: string, options?: FetchOptions) => Promise<FetchResponse>;

export interface HttpClientOptions {
  readonly host: string;
  readonly port?: number;
  readonly password?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: FetchImpl;
}

/**
 * Default seam: adapt `undici.request` to the `FetchImpl` shape (no cast).
 * Excluded from coverage — it performs real network I/O and is exercised only by the
 * gated e2e (Task 7); unit tests always inject a `FetchImpl`.
 */
/* v8 ignore start */
const defaultFetchImpl: FetchImpl = async (url, options) => {
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const res = await undiciRequest(url, {
    method: options?.method ?? 'GET',
    ...(options?.headers !== undefined ? { headers: options.headers } : {}),
    ...(options?.body !== undefined ? { body: options.body } : {}),
    headersTimeout: timeout,
    bodyTimeout: timeout,
  });
  return {
    statusCode: res.statusCode,
    json: () => res.body.json(),
    text: () => res.body.text(),
  };
};
/* v8 ignore stop */

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchImpl;
  private authenticated = false;

  constructor(options: HttpClientOptions) {
    const host = options.host.trim();
    const port = options.port ?? DEFAULT_PORT;
    this.baseUrl = `http://${host}:${port}`;
    this.password = options.password ?? '';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? defaultFetchImpl;
  }

  /** POST the base64-encoded password to `/set_login_info`. No-op when no password is set. */
  async authenticate(): Promise<void> {
    if (!this.password) {
      this.authenticated = true;
      return;
    }
    const body = `pwd=${toBase64(this.password)}`;
    const res = await this.fetchImpl(`${this.baseUrl}/set_login_info`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      timeoutMs: this.timeoutMs,
    });
    if (res.statusCode === 200) {
      this.authenticated = true;
      return;
    }
    if (AUTH_STATUSES.has(res.statusCode)) {
      throw new Error('Ecowitt local auth failed: invalid password');
    }
    throw new Error(`Ecowitt local auth failed: HTTP ${res.statusCode}`);
  }

  /** GET an endpoint and return its parsed JSON body. Re-auths + retries once on 401/403. */
  async getJson(path: string, query?: Readonly<Record<string, string>>): Promise<unknown> {
    const url = this.buildUrl(path, query);
    let res = await this.fetchImpl(url, { method: 'GET', timeoutMs: this.timeoutMs });

    if (AUTH_STATUSES.has(res.statusCode)) {
      await this.authenticate();
      res = await this.fetchImpl(url, { method: 'GET', timeoutMs: this.timeoutMs });
      if (AUTH_STATUSES.has(res.statusCode)) {
        throw new Error(`Ecowitt local auth expired: HTTP ${res.statusCode}`);
      }
    }
    if (res.statusCode !== 200) {
      throw new Error(`Ecowitt local request failed: HTTP ${res.statusCode} for ${path}`);
    }
    return res.json();
  }

  private buildUrl(path: string, query?: Readonly<Record<string, string>>): string {
    if (!query) return `${this.baseUrl}${path}`;
    const qs = new URLSearchParams(query).toString();
    return `${this.baseUrl}${path}?${qs}`;
  }
}
