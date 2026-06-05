import { describe, it, expect } from 'vitest';
import { Station } from '../../src/model/station.js';
import { decodePushForm } from '../../src/push/ecowitt-form.js';

describe('Station.ingestPushResult', () => {
  it('creates sensors keyed by passkey + channel/group from a decoded push body', () => {
    const station = new Station();
    const result = decodePushForm({
      PASSKEY: 'PK1',
      tempf: '50.0',
      humidity: '82',
      temp1f: '68.0',
      humidity1: '45',
      soilmoisture1: '33',
      pm25_ch1: '12.5',
    });
    const changed = station.ingestPushResult(result, 1000);
    const sensors = station.getSensors();
    const outTemp = sensors.find((s) => s.quantity === 'temperature' && s.channel === undefined);
    expect(outTemp?.value).toBeCloseTo(10, 1);
    expect(outTemp?.id.startsWith('PK1')).toBe(true);
    const ch1Temp = sensors.find((s) => s.quantity === 'temperature' && s.channel === 1);
    expect(ch1Temp?.value).toBeCloseTo(20, 1);
    expect(changed.length).toBeGreaterThanOrEqual(4);
  });

  it('attaches an already-decoded push battery (percent) to its channel owner — no re-decode', () => {
    const station = new Station();
    const result = decodePushForm({ PASSKEY: 'PK1', soilmoisture1: '33', soilbatt1: '4' });
    station.ingestPushResult(result, 1000);
    const owner = station.getSensors().find((s) => s.quantity === 'humidity' && s.channel === 1);
    expect(owner?.battery).toBe(80); // decodePushForm already produced 4*20=80
    expect(owner?.batteryUnit).toBe('%');
  });

  it('carries a push voltage field (unit V) as a raw-voltage battery', () => {
    const station = new Station();
    const result = decodePushForm({ PASSKEY: 'PK1', tempf: '50.0', wh68batt: '2.7' });
    station.ingestPushResult(result, 1000);
    const owner = station.getSensors().find((s) => s.quantity === 'temperature');
    expect(owner?.battery).toBe(2.7);
    expect(owner?.batteryUnit).toBe('V');
  });

  it('keys by passkey so two stations do not collide', () => {
    const station = new Station();
    station.ingestPushResult(decodePushForm({ PASSKEY: 'A', tempf: '50.0' }), 1000);
    station.ingestPushResult(decodePushForm({ PASSKEY: 'B', tempf: '68.0' }), 1000);
    expect(station.getSensors().filter((s) => s.quantity === 'temperature')).toHaveLength(2);
  });
});
