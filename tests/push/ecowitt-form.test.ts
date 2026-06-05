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
