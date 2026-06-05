import { describe, it, expect } from 'vitest';
import { decodePushForm } from '../../src/push/ecowitt-form.js';

describe('decodePushForm — metadata + tolerance', () => {
  it('captures station metadata and emits no readings for a metadata-only body', () => {
    const result = decodePushForm({
      PASSKEY: 'ABCDEF0123456789',
      stationtype: 'GW2000A_V3.1.4',
      model: 'GW2000A',
      freq: '868M',
      dateutc: '2026-06-05 10:00:00',
    });
    expect(result.passkey).toBe('ABCDEF0123456789');
    expect(result.station.stationtype).toBe('GW2000A_V3.1.4');
    expect(result.station.model).toBe('GW2000A');
    expect(result.readings).toEqual([]);
  });

  it('ignores unknown keys without throwing', () => {
    const result = decodePushForm({ PASSKEY: 'X', someFutureField: '42', notARealField: 'oops' });
    expect(result.readings.find((r) => r.key === 'someFutureField')).toBeUndefined();
    expect(result.readings.find((r) => r.key === 'notARealField')).toBeUndefined();
    expect(result.passkey).toBe('X');
  });
});

describe('decodePushForm — scalar measurements (imperial -> SI)', () => {
  it('decodes indoor/outdoor/wind/rain/solar fields into SI', () => {
    const { readings } = decodePushForm({
      PASSKEY: 'X',
      tempinf: '71.6',
      humidityin: '48',
      baromrelin: '29.92',
      baromabsin: '29.50',
      tempf: '50.0',
      humidity: '82',
      winddir: '210',
      windspeedmph: '5.0',
      windgustmph: '8.0',
      maxdailygust: '12.0',
      rainratein: '0.04',
      dailyrainin: '0.10',
      solarradiation: '450.3',
      uv: '4',
    });
    const by = (k: string) => readings.find((r) => r.key === k);

    expect(by('tempinf')?.value).toBeCloseTo(22.0, 1);
    expect(by('tempinf')?.unit).toBe('°C');
    expect(by('humidityin')?.value).toBe(48);
    expect(by('humidityin')?.unit).toBe('%');
    expect(by('baromrelin')?.value).toBeCloseTo(1013.21, 1);
    expect(by('baromrelin')?.unit).toBe('hPa');
    expect(by('tempf')?.value).toBeCloseTo(10.0, 1);
    expect(by('humidity')?.value).toBe(82);
    expect(by('winddir')?.value).toBe(210);
    expect(by('windspeedmph')?.value).toBeCloseTo(2.235, 2);
    expect(by('windspeedmph')?.unit).toBe('m/s');
    expect(by('maxdailygust')?.unit).toBe('m/s');
    expect(by('rainratein')?.value).toBeCloseTo(1.016, 2);
    expect(by('dailyrainin')?.value).toBeCloseTo(2.54, 2);
    expect(by('solarradiation')?.value).toBeCloseTo(450.3, 1);
    expect(by('uv')?.value).toBe(4);
  });
});

describe('decodePushForm — per-channel measurements', () => {
  it('decodes numbered channel fields with channel set', () => {
    const { readings } = decodePushForm({
      PASSKEY: 'X',
      temp1f: '68.0',
      humidity1: '45',
      temp2f: '70.0',
      humidity2: '50',
      soilmoisture1: '33',
      tf_ch1: '59.0',
      pm25_ch1: '12.5',
      pm25_avg_24h_ch1: '10.0',
      leak_ch1: '1',
    });
    const by = (k: string) => readings.find((r) => r.key === k);

    expect(by('temp1f')?.value).toBeCloseTo(20.0, 1);
    expect(by('temp1f')?.channel).toBe(1);
    expect(by('humidity1')?.value).toBe(45);
    expect(by('humidity1')?.channel).toBe(1);
    expect(by('temp2f')?.channel).toBe(2);
    expect(by('soilmoisture1')?.value).toBe(33);
    expect(by('soilmoisture1')?.channel).toBe(1);
    expect(by('tf_ch1')?.value).toBeCloseTo(15.0, 1);
    expect(by('tf_ch1')?.channel).toBe(1);
    expect(by('pm25_ch1')?.value).toBeCloseTo(12.5, 1);
    expect(by('pm25_ch1')?.channel).toBe(1);
    expect(by('leak_ch1')?.value).toBe(1);
    expect(by('leak_ch1')?.channel).toBe(1);
  });
});
