import { describe, it, expect, afterEach, vi } from 'vitest';
import { Ecowitt, __createListenerWith, type ListenerTransport } from '../../src/api/ecowitt.js';
import type { PushDecodeResult } from '../../src/push/ecowitt-form.js';

let client: Ecowitt | undefined;
afterEach(async () => {
  if (client) await client.stop();
  client = undefined;
});

const BODY = ['PASSKEY=PK1', 'tempf=50.0', 'humidity=82', 'soilmoisture1=33', 'soilbatt1=4'].join(
  '&',
);

describe('Ecowitt.createListener (real listener, ephemeral port)', () => {
  it('decodes a synthetic POST into Station sensors and emits events', async () => {
    client = Ecowitt.createListener({ port: 0 });
    const updates: number[] = [];
    client.on('update', (s) => updates.push(s.length));

    await client.start();
    const addr = client.getAddress();
    expect(addr).toBeDefined();

    const res = await fetch(`http://127.0.0.1:${String(addr?.port)}/data/report/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: BODY,
    });
    expect(res.status).toBe(200);
    // allow the event loop to deliver onReadings
    await new Promise((r) => setTimeout(r, 30));

    const snap = client.getStation();
    expect(snap.sensors.find((s) => s.quantity === 'temperature')?.value).toBeCloseTo(10, 1);
    const soil = snap.sensors.find((s) => s.quantity === 'humidity' && s.channel === 1);
    expect(soil?.battery).toBe(80);
    expect(soil?.batteryUnit).toBe('%');
    expect(updates.length).toBeGreaterThanOrEqual(1);
  });

  it('local transport has no bound address (getAddress is undefined)', () => {
    const local = Ecowitt.createLocal({ host: '127.0.0.1' });
    expect(local.getAddress()).toBeUndefined();
  });
});

describe('Ecowitt.createListener (wired via the internal seam)', () => {
  it('routes decoded push results into the Station and forwards errors', async () => {
    let onReadings: ((r: PushDecodeResult) => void) | undefined;
    let onError: ((e: unknown) => void) | undefined;
    const start = vi.fn(async () => {});
    const stop = vi.fn(async () => {});
    const build = (opts: {
      onReadings: (r: PushDecodeResult) => void;
      onError: (e: unknown) => void;
    }): ListenerTransport => {
      onReadings = opts.onReadings;
      onError = opts.onError;
      return { start, stop, getAddress: () => undefined };
    };

    client = __createListenerWith({}, build);
    const updates: number[] = [];
    const errors: string[] = [];
    client.on('update', (s) => updates.push(s.length));
    client.on('error', (e) => errors.push(e.message));

    await client.start();
    onReadings?.({
      passkey: 'PK',
      station: {},
      readings: [{ key: 'tempf', value: 10, unit: '°C', raw: '50.0' }],
    });
    onError?.(new Error('listener boom'));

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(errors).toContain('listener boom');
    expect(start).toHaveBeenCalledTimes(1);

    await client.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
