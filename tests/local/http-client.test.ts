import { describe, it, expect, vi } from 'vitest';
import { HttpClient, type FetchImpl, type FetchResponse } from '../../src/local/http-client.js';

function jsonResponse(body: unknown, status = 200): FetchResponse {
  return {
    statusCode: status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('HttpClient', () => {
  it('GETs the right absolute URL on host:port and returns parsed JSON', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ ok: 1 }));
    const client = new HttpClient({ host: '192.168.20.181', port: 80, fetchImpl });

    const data = await client.getJson('/get_version');

    expect(data).toEqual({ ok: 1 });
    const [url, opts] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://192.168.20.181:80/get_version');
    expect(opts?.method ?? 'GET').toBe('GET');
  });

  it('encodes the password as base64 in a form POST to /set_login_info before the GET', async () => {
    const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
    const fetchImpl: FetchImpl = async (url, opts) => {
      calls.push({ url, method: opts?.method ?? 'GET', body: opts?.body });
      return jsonResponse({ ok: 1 });
    };
    const client = new HttpClient({ host: 'h', port: 80, password: 'secret', fetchImpl });

    await client.authenticate();

    const login = calls.find((c) => c.url.endsWith('/set_login_info'));
    expect(login).toBeDefined();
    expect(login!.method).toBe('POST');
    // base64("secret") === "c2VjcmV0"
    expect(login!.body).toBe('pwd=c2VjcmV0');
  });

  it('re-authenticates once and retries when a GET returns 401', async () => {
    let getCount = 0;
    const seen: string[] = [];
    const fetchImpl: FetchImpl = async (url, opts) => {
      seen.push(`${opts?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/set_login_info')) return jsonResponse({ ok: 1 });
      getCount += 1;
      return getCount === 1 ? jsonResponse({}, 401) : jsonResponse({ retried: true });
    };
    const client = new HttpClient({ host: 'h', port: 80, password: 'p', fetchImpl });

    const data = await client.getJson('/get_livedata_info');

    expect(data).toEqual({ retried: true });
    expect(seen.filter((s) => s.includes('/set_login_info')).length).toBe(1);
    expect(getCount).toBe(2);
  });

  it('throws a clear error when a GET ultimately fails (non-200, no auth)', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({}, 500);
    const client = new HttpClient({ host: 'h', port: 80, fetchImpl });
    await expect(client.getJson('/get_version')).rejects.toThrow(/HTTP 500/);
  });

  it('authenticate is a no-op when no password is configured', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({}));
    const client = new HttpClient({ host: 'h', port: 80, fetchImpl });
    await client.authenticate();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws "invalid password" when /set_login_info returns 401', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({}, 401);
    const client = new HttpClient({ host: 'h', port: 80, password: 'wrong', fetchImpl });
    await expect(client.authenticate()).rejects.toThrow(/invalid password/);
  });

  it('throws a clear HTTP error when /set_login_info returns an unexpected status', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({}, 500);
    const client = new HttpClient({ host: 'h', port: 80, password: 'p', fetchImpl });
    await expect(client.authenticate()).rejects.toThrow(/auth failed: HTTP 500/);
  });

  it('throws "auth expired" when the retried GET still returns 401', async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.endsWith('/set_login_info')) return jsonResponse({}, 200);
      return jsonResponse({}, 401);
    };
    const client = new HttpClient({ host: 'h', port: 80, password: 'p', fetchImpl });
    await expect(client.getJson('/get_livedata_info')).rejects.toThrow(/auth expired/);
  });

  it('builds a query string when query params are supplied', async () => {
    const fetchImpl = vi.fn<FetchImpl>(async () => jsonResponse({ ok: 1 }));
    const client = new HttpClient({ host: 'h', port: 80, fetchImpl });
    await client.getJson('/get_sensors_info', { page: '2' });
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://h:80/get_sensors_info?page=2');
  });
});
