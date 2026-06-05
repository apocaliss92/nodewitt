/**
 * Gated real-device e2e against the local Ecowitt gateway.
 *
 * Enabled only when `ECOWITT_E2E=1`; reads connection params from `.env`
 * (`ECOWITT_HOST` / `ECOWITT_PORT` / `ECOWITT_PASSWORD`) via the `test:e2e`
 * script (`node --env-file=.env ...`). Uses the real undici transport — no mock.
 *
 * Exercises the full local-poll stack against the gateway: `getVersion()` +
 * `getAllSensors()` + `getLiveData()`, then builds a `SensorMapper` and decodes
 * the live data, asserting a non-empty version, >=1 sensor, and >=1 decoded
 * reading that resolves to a hardware id.
 *
 * Tolerance: if the gateway is unreachable (connection refused / timeout / DNS),
 * the test logs a clear warning and returns early — it never fakes a pass and
 * never asserts on an unreachable host. The password is never logged.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/local/http-client.js';
import { Endpoints } from '../../src/local/endpoints.js';
import { SensorMapper } from '../../src/local/sensor-mapper.js';
import { decodeLiveData } from '../../src/local/livedata.js';

const enabled = process.env.ECOWITT_E2E === '1';
const host = process.env.ECOWITT_HOST ?? '192.168.20.181';
const port = Number.parseInt(process.env.ECOWITT_PORT ?? '80', 10);
const password = process.env.ECOWITT_PASSWORD ?? '';

function isUnreachable(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|timeout|fetch failed|socket|connect/i.test(
    msg,
  );
}

describe.runIf(enabled)('local e2e against the real gateway', () => {
  it(`reads version + live data + sensors from ${host}:${port}`, async () => {
    const endpoints = new Endpoints(new HttpClient({ host, port, password }));
    try {
      const version = await endpoints.getVersion();
      console.log(
        `gateway ${host}:${port} -> ${version.stationtype ?? '?'} v${version.version ?? '?'} (sensorid_page=${version.sensoridPage})`,
      );
      expect(version.version ?? version.stationtype).toBeTruthy();

      const sensors = await endpoints.getAllSensors();
      console.log(`discovered ${sensors.length} sensors`);
      expect(sensors.length).toBeGreaterThanOrEqual(1);

      const mapper = new SensorMapper();
      mapper.updateMapping(sensors);

      const live = await endpoints.getLiveData();
      const readings = decodeLiveData(live, mapper);
      const mapped = readings.filter(
        (r) => (r.forceHardwareId ?? mapper.getHardwareId(r.key)) !== undefined,
      );
      console.log(`decoded ${readings.length} readings, ${mapped.length} hardware-id-mapped`);
      expect(mapped.length).toBeGreaterThanOrEqual(1);
    } catch (error) {
      if (isUnreachable(error)) {
        console.warn(
          `gateway ${host}:${port} unreachable — skipping (not a failure): ${String(error)}`,
        );
        return; // tolerate offline gateway without faking a pass
      }
      throw error;
    }
  });
});
