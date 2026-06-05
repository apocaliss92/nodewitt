import { describe, it, expect } from 'vitest';
import { Station } from '../../src/model/station.js';
import { decodePushForm } from '../../src/push/ecowitt-form.js';
import type { ResolvedReading } from '../../src/local/poller.js';

const lookup = { getSensorInfo: () => undefined, getSensorInfoForKey: () => undefined };

describe('Station.getStation snapshot', () => {
  it('exposes an immutable snapshot with a sensors array and a count', () => {
    const station = new Station();
    station.ingestPushResult(decodePushForm({ PASSKEY: 'PK', tempf: '50.0' }), 1000);
    const snap = station.getStation();
    expect(snap.sensors.length).toBe(1);
    expect(Object.isFrozen(snap)).toBe(true);
    // a later ingest does not retroactively mutate the earlier frozen snapshot
    station.ingestPushResult(decodePushForm({ PASSKEY: 'PK', humidity: '50' }), 2000);
    expect(snap.sensors.length).toBe(1);
    expect(station.getStation().sensors.length).toBe(2);
  });

  it('does not double-decode: a poll soilbatt percent stays a percent across re-ingest', () => {
    const station = new Station();
    const r: ResolvedReading[] = [
      { key: 'soilmoisture1', value: 33, unit: '%', raw: '33', hardwareId: 'HID' },
      { key: 'soilbatt1', value: 80, unit: '%', raw: '80', hardwareId: 'HID' },
    ];
    station.ingestPollReadings(r, lookup, 1000);
    station.ingestPollReadings(r, lookup, 2000);
    const owner = station.getStation().sensors.find((s) => s.quantity === 'humidity');
    expect(owner?.battery).toBe(80); // still 80, never 80*20
    expect(owner?.batteryUnit).toBe('%');
  });
});
