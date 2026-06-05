/**
 * Gated dump e2e: a SHORT real dump from the gateway at `.env` + a zero-secret scan.
 *
 * Enabled only when `ECOWITT_E2E=1`; reads `ECOWITT_HOST` / `ECOWITT_PORT` / `ECOWITT_PASSWORD`
 * from `.env` via the `test:e2e` script. Tolerates an unreachable gateway (logs a clear warning
 * and returns early — never fakes a pass). The exported JSON is scanned to assert it carries NO
 * mac / PASSKEY / ssid / ip / host string. Secrets are never printed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Ecowitt, createDumper } from '../../src/index.js';

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

let client: Ecowitt | undefined;
afterEach(async () => {
  if (client) await client.stop();
  client = undefined;
});

describe.runIf(enabled)('dump e2e', () => {
  it('builds a short real dump and exports ZERO secrets', async () => {
    // A short poll cadence so multiple live ticks land inside the e2e window.
    client = Ecowitt.createLocal({
      host,
      port,
      pollIntervalMs: 2000,
      ...(password ? { password } : {}),
    });
    client.on('error', (error) => {
      if (!isUnreachable(error)) throw error;
    });
    const dumper = createDumper(client, { captureRawFrames: true });
    try {
      // Attach the dumper BEFORE start() so the very first poll's update/rawFrame is captured.
      dumper.start();
      await client.start();
      // observe ~8s so several polls land and the accumulator fills
      const deadline = Date.now() + 8000;
      while (
        Date.now() < deadline &&
        Object.keys(dumper.export().observations.properties).length === 0
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      dumper.stop();
      const dump = dumper.export();
      const json = dumper.exportJson();
      if (client.getStation().sensors.length === 0) {
        console.warn(`gateway ${host}:${port} produced no sensors — skipping (not a failure)`);
        return;
      }
      // structure
      expect(dump.library).toBe('nodewitt');
      expect(dump.schemaVersion).toBe(1);
      expect(Object.keys(dump.observations.properties).length).toBeGreaterThan(0);
      expect(Array.isArray(dump.catalog.sensors)).toBe(true);
      // ZERO secrets in the serialized output (scan the JSON itself)
      for (const needle of ['passkey', 'ssid', 'macaddress', 'bssid']) {
        expect(json.toLowerCase()).not.toContain(needle);
      }
      // a bare `"mac"` key must not survive (the redactor scrubs it)
      expect(json).not.toContain('"mac"');
      // The configured host/IP must not appear verbatim.
      if (host) expect(json).not.toContain(host);

      const unmappedModels = Object.entries(dump.observations.properties)
        .filter(([k, v]) => k.startsWith('model:') && v.unmapped.length > 0)
        .map(([k]) => k);
      const unmappedKeys = Object.entries(dump.observations.properties)
        .filter(([k, v]) => k.startsWith('key:') && v.unmapped.length > 0)
        .map(([k]) => k);
      const unmappedBatteries = Object.entries(dump.observations.properties)
        .filter(([k, v]) => k.startsWith('battery:') && v.unmapped.length > 0)
        .map(([k]) => k);
      console.log(
        `dump: ${Object.keys(dump.observations.properties).length} props, ` +
          `${dump.catalog.sensors?.length ?? 0} sensors, ` +
          `${dump.observations.rawFrames?.length ?? 0} raw frames; ` +
          `unmapped models: ${unmappedModels.join(',') || 'none'}; ` +
          `unmapped keys: ${unmappedKeys.join(',') || 'none'}; ` +
          `unmapped batteries: ${unmappedBatteries.join(',') || 'none'}`,
      );
    } catch (error) {
      if (isUnreachable(error)) {
        console.warn(`gateway unreachable — skipping (not a failure): ${String(error)}`);
        return;
      }
      throw error;
    }
  });
});
