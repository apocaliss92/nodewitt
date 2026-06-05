import { describe, it, expect } from 'vitest';
import { classifyKey } from '../../src/model/quantity.js';

describe('classifyKey', () => {
  it('classifies a hex-id key via the hex table', () => {
    expect(classifyKey('0x02')).toEqual({ kind: 'measurement', quantity: 'temperature' });
    expect(classifyKey('0x0E')).toEqual({ kind: 'measurement', quantity: 'precipitation_rate' });
  });

  it('classifies named scalar/channel measurement keys', () => {
    expect(classifyKey('tempf')).toEqual({ kind: 'measurement', quantity: 'temperature' });
    expect(classifyKey('humidity3')).toEqual({ kind: 'measurement', quantity: 'humidity' });
    expect(classifyKey('soilmoisture1')).toEqual({ kind: 'measurement', quantity: 'humidity' });
    expect(classifyKey('windspeedmph')).toEqual({ kind: 'measurement', quantity: 'wind_speed' });
  });

  it('classifies lightning keys with dedicated lightning quantities (no precipitation mislabel)', () => {
    expect(classifyKey('lightning')).toEqual({
      kind: 'measurement',
      quantity: 'lightning_distance',
    });
    expect(classifyKey('lightning_num')).toEqual({
      kind: 'measurement',
      quantity: 'lightning_count',
    });
  });

  it('classifies percent batteries (already-decoded by the poll decoders)', () => {
    expect(classifyKey('wh26batt')).toEqual({ kind: 'battery', batteryUnit: '%' });
    expect(classifyKey('soilbatt1')).toEqual({ kind: 'battery', batteryUnit: '%' });
    expect(classifyKey('co2_batt')).toEqual({ kind: 'battery', batteryUnit: '%' });
    expect(classifyKey('ws90batt')).toEqual({ kind: 'battery', batteryUnit: '%' });
  });

  it('classifies raw-voltage batteries (NOT a percent — no double-decode)', () => {
    expect(classifyKey('ws90_voltage')).toEqual({ kind: 'battery', batteryUnit: 'V' });
    expect(classifyKey('ws90cap_volt')).toEqual({ kind: 'battery', batteryUnit: 'V' });
    expect(classifyKey('wh68batt')).toEqual({ kind: 'battery', batteryUnit: 'V' });
    expect(classifyKey('wh80batt')).toEqual({ kind: 'battery', batteryUnit: 'V' });
  });

  it('does not mis-read a channelized battery as its measurement (battery wins)', () => {
    expect(classifyKey('tf_batt1')).toEqual({ kind: 'battery', batteryUnit: '%' });
  });

  it('returns unknown for keys it does not recognize', () => {
    expect(classifyKey('someFutureField')).toEqual({ kind: 'unknown' });
  });
});
