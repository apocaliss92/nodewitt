import { describe, it, expect } from 'vitest';
import { parseValue } from '../../src/protocol/parse-value.js';

describe('parseValue — SI normalization', () => {
  it('strips a percent suffix (no conversion)', () => {
    expect(parseValue('62%')).toEqual({ value: 62, unit: '%', raw: '62%' });
  });

  it('strips " hPa" (already SI)', () => {
    expect(parseValue('1013.2 hPa')).toEqual({ value: 1013.2, unit: 'hPa', raw: '1013.2 hPa' });
  });

  it('converts mph -> m/s', () => {
    const r = parseValue('10 mph');
    expect(r.unit).toBe('m/s');
    expect(r.value).toBeCloseTo(4.4707, 4);
    expect(r.raw).toBe('10 mph');
  });

  it('converts °F -> °C', () => {
    const r = parseValue('68 °F');
    expect(r.unit).toBe('°C');
    expect(r.value).toBeCloseTo(20, 6);
  });

  it('converts inHg -> hPa', () => {
    const r = parseValue('29.92 inHg');
    expect(r.unit).toBe('hPa');
    expect(r.value).toBeCloseTo(1013.21, 1);
  });

  it('converts in -> mm (rain)', () => {
    const r = parseValue('1 in');
    expect(r.unit).toBe('mm');
    expect(r.value).toBeCloseTo(25.4, 6);
  });

  it('converts mi -> km (lightning distance "5 km" stays, "3 mi" converts)', () => {
    expect(parseValue('5 km')).toEqual({ value: 5, unit: 'km', raw: '5 km' });
    const r = parseValue('3 mi');
    expect(r.unit).toBe('km');
    expect(r.value).toBeCloseTo(4.828032, 5);
  });

  it('converts km/h -> m/s', () => {
    const r = parseValue('36 km/h');
    expect(r.unit).toBe('m/s');
    expect(r.value).toBeCloseTo(10, 6);
  });

  it('converts in/Hr -> mm/Hr (rain rate)', () => {
    const r = parseValue('2 in/Hr');
    expect(r.unit).toBe('mm/Hr');
    expect(r.value).toBeCloseTo(50.8, 6);
  });

  it('accepts the degF / mile aliases', () => {
    const f = parseValue({ val: '32', unit: 'degF' });
    expect(f).toEqual({ value: 0, unit: '°C', raw: '32 degF' });
    const m = parseValue({ val: '2', unit: 'mile' });
    expect(m.unit).toBe('km');
    expect(m.value).toBeCloseTo(3.218688, 6);
  });

  it('accepts a numeric val in a split pair (not just a string)', () => {
    expect(parseValue({ val: 50, unit: 'inch' })).toEqual({
      value: 1270,
      unit: 'mm',
      raw: '50 inch',
    });
  });

  it('accepts a split {val,unit} pair', () => {
    const r = parseValue({ val: '2.24', unit: 'mph' });
    expect(r.unit).toBe('m/s');
    expect(r.value).toBeCloseTo(1.0014, 3);
  });

  it('accepts the bare "F" and "kmh" unit aliases', () => {
    const f = parseValue({ val: '212', unit: 'F' });
    expect(f).toEqual({ value: 100, unit: '°C', raw: '212 F' });
    const w = parseValue({ val: '18', unit: 'kmh' });
    expect(w.unit).toBe('m/s');
    expect(w.value).toBeCloseTo(5, 6);
  });

  it('accepts a bare numeric string (dimensionless)', () => {
    expect(parseValue('42')).toEqual({ value: 42, unit: '', raw: '42' });
  });

  it('accepts a negative value', () => {
    expect(parseValue('-3.5 °C')).toEqual({ value: -3.5, unit: '°C', raw: '-3.5 °C' });
  });

  it('throws a clear error on non-numeric input (never NaN)', () => {
    expect(() => parseValue('None')).toThrow(/non-numeric/i);
    expect(() => parseValue('')).toThrow(/non-numeric/i);
    expect(() => parseValue('--')).toThrow(/non-numeric/i);
    expect(() => parseValue({ val: 'abc', unit: '%' })).toThrow(/non-numeric/i);
  });
});
