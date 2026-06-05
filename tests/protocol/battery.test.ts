import { describe, it, expect } from 'vitest';
import {
  decodeBinaryBattery,
  decodeBarBattery,
  decodeVoltageBattery,
  voltToPercent,
} from '../../src/protocol/battery.js';

describe('battery decode', () => {
  describe('binary', () => {
    it('"0" -> 100%, "1" -> 10%', () => {
      expect(decodeBinaryBattery('0')).toEqual({ percent: 100, raw: '0', kind: 'binary' });
      expect(decodeBinaryBattery('1')).toEqual({ percent: 10, raw: '1', kind: 'binary' });
    });

    it('unparseable binary -> percent null', () => {
      expect(decodeBinaryBattery('x')).toEqual({ percent: null, raw: 'x', kind: 'binary' });
    });
  });

  describe('bar (0-5 scale)', () => {
    it('multiplies by 20 and clamps to 100', () => {
      expect(decodeBarBattery('3')).toEqual({ percent: 60, raw: '3', kind: 'bar' });
      expect(decodeBarBattery('5')).toEqual({ percent: 100, raw: '5', kind: 'bar' });
      expect(decodeBarBattery('6')).toEqual({ percent: 100, raw: '6', kind: 'bar' });
      expect(decodeBarBattery('0')).toEqual({ percent: 0, raw: '0', kind: 'bar' });
    });

    it('non-digit bar -> percent null', () => {
      expect(decodeBarBattery('low')).toEqual({ percent: null, raw: 'low', kind: 'bar' });
    });
  });

  describe('voltage', () => {
    it('linear interpolation between low/high, clamped 0-100', () => {
      expect(voltToPercent(2.4, 2.4, 3.0)).toBe(0);
      expect(voltToPercent(3.0, 2.4, 3.0)).toBe(100);
      expect(voltToPercent(2.7, 2.4, 3.0)).toBe(50);
      expect(voltToPercent(2.0, 2.4, 3.0)).toBe(0); // below low -> clamp
      expect(voltToPercent(3.5, 2.4, 3.0)).toBe(100); // above high -> clamp
    });

    it('rounds like the reference formula', () => {
      // (2.55 - 2.4)/(3.0 - 2.4)*100 = 25
      expect(voltToPercent(2.55, 2.4, 3.0)).toBe(25);
    });

    it('decodeVoltageBattery uses default 2.4/3.0 thresholds', () => {
      expect(decodeVoltageBattery('2.7')).toEqual({ percent: 50, raw: '2.7', kind: 'voltage' });
    });

    it('decodeVoltageBattery accepts custom thresholds', () => {
      // WN34 style 1xAA: low 1.2, high 1.6 -> 1.4 = 50%
      expect(decodeVoltageBattery('1.4', 1.2, 1.6)).toEqual({
        percent: 50,
        raw: '1.4',
        kind: 'voltage',
      });
    });

    it('non-numeric voltage -> percent null', () => {
      expect(decodeVoltageBattery('None')).toEqual({ percent: null, raw: 'None', kind: 'voltage' });
    });
  });
});
