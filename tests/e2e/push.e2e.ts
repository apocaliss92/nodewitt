/**
 * Gated push-listener e2e (no gateway reconfiguration needed).
 *
 * Enabled when `ECOWITT_E2E=1`. Starts the real `PushListener` on an ephemeral port and sends a
 * LOCAL synthetic Ecowitt "Customized" upload (a realistic x-www-form-urlencoded body) to it,
 * then asserts the decoded readings (SI-normalized, battery decoded, per-channel). A real upload
 * from the gateway's "Customized" config is optional/manual and not required here.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PushListener } from '../../src/push/listener.js';
import type { PushDecodeResult } from '../../src/push/ecowitt-form.js';

const enabled = process.env.ECOWITT_E2E === '1';

let listener: PushListener | undefined;
afterEach(async () => {
  if (listener) await listener.stop();
  listener = undefined;
});

// A realistic synthetic "Customized" upload body (Wunderground-style, urlencoded).
const SYNTHETIC_BODY = [
  'PASSKEY=ABCDEF0123456789',
  'stationtype=GW2000A_V3.1.4',
  'model=GW2000A',
  'dateutc=2026-06-05+10:00:00',
  'tempinf=71.6',
  'humidityin=48',
  'baromrelin=29.92',
  'baromabsin=29.50',
  'tempf=50.0',
  'humidity=82',
  'winddir=210',
  'windspeedmph=5.0',
  'windgustmph=8.0',
  'maxdailygust=12.0',
  'rainratein=0.04',
  'dailyrainin=0.10',
  'solarradiation=450.3',
  'uv=4',
  'temp1f=68.0',
  'humidity1=45',
  'soilmoisture1=33',
  'pm25_ch1=12.5',
  'wh65batt=0',
  'soilbatt1=4',
  'wh90batt=2.7',
  'freq=868M',
].join('&');

describe.runIf(enabled)('push e2e: local synthetic upload', () => {
  it('starts the listener and decodes a synthetic POST', async () => {
    const results: PushDecodeResult[] = [];
    listener = new PushListener({ port: 0, onReadings: (r) => results.push(r) });
    const addr = await listener.start();

    const res = await fetch(`http://127.0.0.1:${addr.port}/data/report/`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: SYNTHETIC_BODY,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('OK');

    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result?.passkey).toBe('ABCDEF0123456789');
    expect(result?.station.model).toBe('GW2000A');

    const by = (k: string) => result?.readings.find((r) => r.key === k);
    expect(by('tempf')?.value).toBeCloseTo(10.0, 1);
    expect(by('tempf')?.unit).toBe('°C');
    expect(by('windspeedmph')?.unit).toBe('m/s');
    expect(by('baromrelin')?.unit).toBe('hPa');
    expect(by('soilmoisture1')?.channel).toBe(1);
    expect(by('pm25_ch1')?.channel).toBe(1);
    expect(by('wh65batt')?.battery).toBe(100);
    expect(by('soilbatt1')?.battery).toBe(80);
    expect(by('wh90batt')?.battery).toBe(50);

    expect(result?.readings.length ?? 0).toBeGreaterThan(0);
  });
});
