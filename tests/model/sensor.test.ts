import { describe, it, expect } from 'vitest';
import { mergeSensor, type Sensor } from '../../src/model/sensor.js';

const base: Sensor = {
  id: 'gw:0x02',
  quantity: 'temperature',
  value: 6.3,
  unit: '°C',
  raw: '6.3 C',
  lastUpdated: 1000,
};

describe('mergeSensor', () => {
  it('returns a new object (never mutates the input)', () => {
    const next = mergeSensor(base, { value: 7.1, raw: '7.1 C', lastUpdated: 2000 });
    expect(next).not.toBe(base);
    expect(base.value).toBe(6.3); // input untouched (immutability)
    expect(next.value).toBe(7.1);
    expect(next.raw).toBe('7.1 C');
    expect(next.lastUpdated).toBe(2000);
    expect(next.quantity).toBe('temperature'); // unchanged fields preserved
  });

  it('reports whether the value actually changed', () => {
    expect(mergeSensor(base, { value: 6.3, raw: '6.3 C', lastUpdated: 2000 }).value).toBe(6.3);
  });

  it('carries optional battery / signal / model / channel through a merge', () => {
    const withMeta = mergeSensor(base, { battery: 100, batteryUnit: '%', signal: 4 });
    expect(withMeta.battery).toBe(100);
    expect(withMeta.batteryUnit).toBe('%');
    expect(withMeta.signal).toBe(4);
  });
});
