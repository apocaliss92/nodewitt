import { describe, it, expect } from 'vitest';
import { SensorMapper } from '../../src/local/sensor-mapper.js';

describe('SensorMapper', () => {
  it('maps a WH31 channel sensor to its hardware id via the P1 model keys', () => {
    const m = new SensorMapper();
    m.updateMapping([{ id: 'D1E2F3', img: 'wh31', name: 'Temp & Humidity CH1', signal: '4' }]);
    expect(m.getHardwareId('temp1f')).toBe('D1E2F3');
    expect(m.getHardwareId('humidity1')).toBe('D1E2F3');
    expect(m.getSensorInfo('D1E2F3')?.channel).toBe(1);
  });

  it('maps a WS85 wind & rain sensor (img="ws85") to its hardware id', () => {
    const m = new SensorMapper();
    m.updateMapping([{ id: 'WS85AA', img: 'ws85', name: 'Wind & Rain', signal: '4' }]);
    // wind keys arrive via common_list, rain + battery via piezoRain
    expect(m.getHardwareId('0x0B')).toBe('WS85AA');
    expect(m.getHardwareId('0x0C')).toBe('WS85AA');
    expect(m.getHardwareId('0x13')).toBe('WS85AA');
    expect(m.getHardwareId('ws85batt')).toBe('WS85AA');
    expect(m.getHardwareId('ws85_voltage')).toBe('WS85AA');
    expect(m.getHardwareId('ws85cap_volt')).toBe('WS85AA');
  });

  it('filters dead ids (FFFFFFFF, FFFFFFFE, 00000000)', () => {
    const m = new SensorMapper();
    m.updateMapping([
      { id: 'FFFFFFFF', img: 'wh31', name: 'Temp & Humidity CH1', signal: '0' },
      { id: 'FFFFFFFE', img: 'wh31', name: 'Temp & Humidity CH2', signal: '0' },
      { id: '00000000', img: 'wh31', name: 'Temp & Humidity CH3', signal: '0' },
    ]);
    expect(m.getHardwareId('temp1f')).toBeUndefined();
    expect(m.getHardwareId('temp3f')).toBeUndefined();
    expect(m.getAllHardwareIds()).toEqual([]);
  });

  it('signal-wins: the stronger-signal sensor owns a shared key (WH65 vs WH90 0x02 overlap)', () => {
    const m = new SensorMapper();
    m.updateMapping([
      { id: 'STALE0', img: 'wh69', name: 'Solar & Wind', signal: '0' },
      { id: 'ACTIVE9', img: 'wh90', name: 'Solar & Wind & Rain', signal: '4' },
    ]);
    // 0x02 is claimed by both wh69 and wh90 key sets; the signal=4 sensor wins.
    expect(m.getHardwareId('0x02')).toBe('ACTIVE9');
  });

  it('equal-signal collisions let the later sensor win (donor uses >=)', () => {
    const m = new SensorMapper();
    m.updateMapping([
      { id: 'FIRST5', img: 'wh90', name: 'Array A', signal: '3' },
      { id: 'LATER5', img: 'wh69', name: 'Array B', signal: '3' },
    ]);
    expect(m.getHardwareId('0x02')).toBe('LATER5');
  });

  it('captures battery, signal and a missing-channel as undefined in the sensor info', () => {
    const m = new SensorMapper();
    m.updateMapping([{ id: 'INDOOR', img: 'wh25', name: 'Indoor', batt: '1', signal: '4' }]);
    const info = m.getSensorInfo('INDOOR');
    expect(info?.model).toBe('wh25');
    expect(info?.channel).toBeUndefined(); // no CHn in the name
    expect(info?.battery).toBe('1');
    expect(info?.signal).toBe('4');
    // wh25 is a fixed (non-channelized) model -> its hex keys are owned
    expect(m.getHardwareId('tempinf')).toBe('INDOOR');
  });

  it('treats a non-numeric signal as the -1 fallback so any real signal beats it', () => {
    const m = new SensorMapper();
    m.updateMapping([
      { id: 'JUNK', img: 'wh69', name: 'Array', signal: 'n/a' },
      { id: 'REAL', img: 'wh90', name: 'Array', signal: '0' },
    ]);
    // signal=0 (>= -1) overrides the non-numeric "n/a" entry.
    expect(m.getHardwareId('0x02')).toBe('REAL');
  });

  it('skips an unknown model that yields no live keys but still records its info', () => {
    const m = new SensorMapper();
    m.updateMapping([{ id: 'MYSTERY', img: 'wh999', name: 'Unknown', signal: '4' }]);
    expect(m.getAllHardwareIds()).toEqual(['MYSTERY']);
    expect(m.getHardwareId('temp1f')).toBeUndefined();
  });
});
