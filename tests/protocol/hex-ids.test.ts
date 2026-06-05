import { describe, it, expect } from 'vitest';
import { HEX_IDS, lookupHexId } from '../../src/protocol/hex-ids.js';

describe('hex-id measurement table', () => {
  it('maps outdoor temperature (0x02)', () => {
    expect(lookupHexId('0x02')).toEqual({
      name: 'Outdoor Temperature',
      quantity: 'temperature',
      defaultUnit: '°C',
    });
  });

  it('maps relative pressure (0x09) in hPa', () => {
    expect(lookupHexId('0x09')).toEqual({
      name: 'Relative Pressure',
      quantity: 'pressure',
      defaultUnit: 'hPa',
    });
  });

  it('maps wind speed (0x0B) and max daily gust (0x19)', () => {
    expect(lookupHexId('0x0B')?.quantity).toBe('wind_speed');
    expect(lookupHexId('0x0B')?.defaultUnit).toBe('m/s');
    expect(lookupHexId('0x19')?.name).toBe('Max Daily Gust');
  });

  it('maps rain rate (0x0E) and yearly rain (0x13)', () => {
    expect(lookupHexId('0x0E')).toEqual({
      name: 'Rain Rate',
      quantity: 'precipitation_rate',
      defaultUnit: 'mm/Hr',
    });
    expect(lookupHexId('0x13')?.name).toBe('Yearly Rain');
    expect(lookupHexId('0x13')?.quantity).toBe('precipitation');
  });

  it('maps solar/UV (0x15, 0x16, 0x17) and black-globe/WBGT (0xA1, 0xA2)', () => {
    expect(lookupHexId('0x15')).toEqual({
      name: 'Solar Radiation',
      quantity: 'irradiance',
      defaultUnit: 'W/m²',
    });
    expect(lookupHexId('0x16')?.defaultUnit).toBe('µW/m²');
    expect(lookupHexId('0x17')?.quantity).toBe('uv');
    expect(lookupHexId('0xA1')?.name).toBe('Black Globe Temperature');
    expect(lookupHexId('0xA2')?.name).toBe('WBGT');
  });

  it('maps Feels Like (decimal id "3", distinct from 0x03 Dewpoint)', () => {
    expect(lookupHexId('3')).toEqual({
      name: 'Feels Like',
      quantity: 'temperature',
      defaultUnit: '°C',
    });
    // regression: the hex 0x03 id is still Dewpoint, not shadowed by "3"
    expect(lookupHexId('0x03')?.name).toBe('Dewpoint Temperature');
  });

  it('maps VPD (decimal id "5", distinct from 0x05 Heat Index)', () => {
    expect(lookupHexId('5')).toEqual({
      name: 'VPD',
      quantity: 'vpd',
      defaultUnit: 'kPa',
    });
    // regression: the hex 0x05 id is still Heat Index, not shadowed by "5"
    expect(lookupHexId('0x05')?.name).toBe('Heat Index');
  });

  it('does not include 0x0F (rain-gain calibration is not a measurement)', () => {
    expect(lookupHexId('0x0F')).toBeUndefined();
  });

  it('returns undefined for an unknown id without throwing', () => {
    expect(lookupHexId('0xZZ')).toBeUndefined();
  });

  it('exposes the full table as a frozen record', () => {
    expect(Object.isFrozen(HEX_IDS)).toBe(true);
    // sanity: every entry has the three required fields
    for (const entry of Object.values(HEX_IDS)) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.quantity).toBe('string');
      expect(typeof entry.defaultUnit).toBe('string');
    }
  });
});
