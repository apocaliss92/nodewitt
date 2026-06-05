import { describe, it, expect, afterEach } from 'vitest';
import { PushListener, type PushListenerOptions } from '../../src/push/listener.js';
import type { AddressInfo } from 'node:net';
import type { PushDecodeResult } from '../../src/push/ecowitt-form.js';

let listener: PushListener | undefined;

afterEach(async () => {
  if (listener) await listener.stop();
  listener = undefined;
});

async function post(port: number, body: string): Promise<{ status: number; text: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/data/report/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return { status: res.status, text: await res.text() };
}

describe('PushListener', () => {
  it('receives a POST, parses the urlencoded body, responds OK', async () => {
    const received: Array<Record<string, string>> = [];
    listener = new PushListener({ port: 0, onForm: (form) => received.push(form) });
    const addr = await listener.start();
    const { status, text } = await post(
      addr.port,
      'PASSKEY=ABC&tempf=50.0&humidity=82&windspeedmph=5.0',
    );
    expect(status).toBe(200);
    expect(text).toBe('OK');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      PASSKEY: 'ABC',
      tempf: '50.0',
      humidity: '82',
      windspeedmph: '5.0',
    });
  });

  it('start() resolves with the bound address', async () => {
    listener = new PushListener({ port: 0, onForm: () => {} });
    const addr: AddressInfo = await listener.start();
    expect(addr.port).toBeGreaterThan(0);
  });
});

describe('PushListener — resilience', () => {
  it('a throwing onForm callback does not crash the server (next POST still works)', async () => {
    let calls = 0;
    listener = new PushListener({
      port: 0,
      onForm: () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });
    const { port } = await listener.start();

    const first = await post(port, 'PASSKEY=A&tempf=50.0');
    expect(first.status).toBe(200);
    expect(first.text).toBe('OK');

    const second = await post(port, 'PASSKEY=B&tempf=51.0');
    expect(second.status).toBe(200);
    expect(calls).toBe(2);
  });

  it('a non-form / garbage body is answered without crashing', async () => {
    const received: Array<Record<string, string>> = [];
    listener = new PushListener({ port: 0, onForm: (f) => received.push(f) });
    const { port } = await listener.start();
    const res = await post(port, '%%%not=a=valid&&form==body%zz');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    // URLSearchParams is lenient: it yields a (possibly odd) map, never throws — still no crash.
    expect(received).toHaveLength(1);
  });

  it('a non-POST request is answered OK without invoking onForm', async () => {
    let called = false;
    listener = new PushListener({ port: 0, onForm: () => (called = true) });
    const { port } = await listener.start();
    const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(called).toBe(false);
  });
});

describe('PushListener — decoded readings', () => {
  it('decodes the form and surfaces readings via onReadings', async () => {
    const results: PushDecodeResult[] = [];
    listener = new PushListener({ port: 0, onReadings: (r) => results.push(r) });
    const { port } = await listener.start();
    await post(port, 'PASSKEY=ABC&tempf=50.0&humidity=82&wh65batt=0&pm25_ch1=12.5');

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.passkey).toBe('ABC');
    const by = (k: string) => result?.readings.find((rr) => rr.key === k);
    expect(by('tempf')?.value).toBeCloseTo(10.0, 1);
    expect(by('humidity')?.value).toBe(82);
    expect(by('wh65batt')?.battery).toBe(100);
    expect(by('pm25_ch1')?.channel).toBe(1);
  });

  it('throws when neither onForm nor onReadings is provided', () => {
    const opts: PushListenerOptions = { port: 0 };
    expect(() => new PushListener(opts)).toThrow();
  });
});
