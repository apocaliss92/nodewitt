import { describe, it, expect } from 'vitest';
import { liveDataKeysForModel } from '../../src/protocol/sensor-models.js';

describe('sensor model -> live-data keys', () => {
  it('wh31 (temp/hum, channelized)', () => {
    expect(liveDataKeysForModel('wh31', 3)).toEqual(['temp3f', 'humidity3', 'batt3']);
  });

  it('wh51 soil moisture (channelized)', () => {
    expect(liveDataKeysForModel('wh51', 2)).toEqual([
      'soilmoisture2',
      'soilad2',
      'soiltemp2',
      'soilec2',
      'soilbatt2',
    ]);
  });

  it('wh41 PM2.5 (channelized)', () => {
    expect(liveDataKeysForModel('wh41', 1)).toEqual([
      'pm25_ch1',
      'pm25_avg_24h_ch1',
      'pm25_aqi_realtime_ch1',
      'pm25_aqi_24h_ch1',
      'pm25batt1',
    ]);
  });

  it('wh57 lightning (no channel)', () => {
    expect(liveDataKeysForModel('wh57')).toEqual([
      'lightning_num',
      'lightning_time',
      'lightning',
      'lightning_mi',
      'wh57batt',
    ]);
  });

  it('wh40 rain (hex ids + battery)', () => {
    expect(liveDataKeysForModel('wh40')).toEqual([
      '0x0D',
      '0x0E',
      '0x7C',
      '0x10',
      '0x11',
      '0x12',
      '0x13',
      'wh40batt',
    ]);
  });

  it('wh69 / wh65 share the 7-in-1 array set', () => {
    const keys = liveDataKeysForModel('wh69');
    expect(keys).toEqual(liveDataKeysForModel('wh65'));
    expect(keys).toContain('0x02');
    expect(keys).toContain('0x14');
    expect(keys).toContain('3'); // Feels Like (decimal id)
    expect(keys).toContain('5'); // VPD (decimal id)
    expect(keys.at(-1)).toBe('wh69batt');
  });

  it('ws90 array exposes voltage + capacitor-voltage keys', () => {
    const keys = liveDataKeysForModel('ws90');
    expect(keys).toContain('ws90batt');
    expect(keys).toContain('ws90_voltage');
    expect(keys).toContain('ws90cap_volt');
  });

  it('wh80 wind/solar station (no rain hex ids)', () => {
    const keys = liveDataKeysForModel('wh80');
    expect(keys).toContain('0x15');
    expect(keys).not.toContain('0x0D');
    expect(keys.at(-1)).toBe('wh80batt');
  });

  it('wh90 array with voltage keys', () => {
    const keys = liveDataKeysForModel('wh90');
    expect(keys).toContain('wh90batt');
    expect(keys).toContain('wh90_voltage');
    expect(keys).toContain('wh90cap_volt');
  });

  it('wh25 indoor station', () => {
    expect(liveDataKeysForModel('wh25')).toEqual([
      'tempinf',
      'humidityin',
      'baromrelin',
      'baromabsin',
      '0x01',
      '0x06',
      '0x08',
      '0x09',
      'wh25batt',
    ]);
  });

  it('wh26 / wn32 outdoor temp/hum', () => {
    expect(liveDataKeysForModel('wh26')).toEqual(['0x02', '0x07', '0x03', 'wh26batt']);
    expect(liveDataKeysForModel('wn32')).toEqual(liveDataKeysForModel('wh26'));
  });

  it('wn34 (temp-only) aliases donor wh34', () => {
    expect(liveDataKeysForModel('wn34', 4)).toEqual(['tf_ch4', 'tf_ch4c', 'tf_batt4']);
  });

  it('wn35 (leaf wetness) aliases donor wh35', () => {
    expect(liveDataKeysForModel('wn35', 1)).toEqual(['leafwetness_ch1', 'leaf_batt1']);
  });

  it('wh55 leak (channelized)', () => {
    expect(liveDataKeysForModel('wh55', 1)).toEqual(['leak_ch1', 'leakbatt1']);
  });

  it('wh54 / lds liquid-depth sensor (channelized)', () => {
    expect(liveDataKeysForModel('wh54', 2)).toEqual([
      'lds_air_ch2',
      'lds_depth_ch2',
      'lds_voltage_ch2',
      'lds_batt2',
      'lds_level_ch2',
      'lds_total_heat_ch2',
    ]);
  });

  it('wh45 combo (CO2 + PM)', () => {
    const keys = liveDataKeysForModel('wh45');
    expect(keys[0]).toBe('tf_co2');
    expect(keys).toContain('co2');
    expect(keys.at(-1)).toBe('co2_batt');
  });

  it('is case-insensitive on the model token', () => {
    expect(liveDataKeysForModel('WH31', 1)).toEqual(liveDataKeysForModel('wh31', 1));
  });

  it('returns [] for an unknown model', () => {
    expect(liveDataKeysForModel('zz99')).toEqual([]);
  });

  it('returns [] for a channelized model with no channel', () => {
    expect(liveDataKeysForModel('wh31')).toEqual([]);
  });
});
