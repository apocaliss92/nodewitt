import { describe, it, expect, afterEach } from 'vitest';
import { PushListener } from '../../src/push/listener.js';
import type { AddressInfo } from 'node:net';

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
