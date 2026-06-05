/**
 * Battery decode for the heterogeneous Ecowitt encodings.
 *
 * Ecowitt reports battery in three incompatible ways depending on sensor:
 *  - binary:  "0" => full (100%), "1" => low (10%)        (WH51/WH31/WH69/WH40)
 *  - bar:     0-5 scale, percent = level * 20, clamp 100  (WH34/WN34, soil 2-5, lightning, *batt)
 *  - voltage: volts -> percent via linear interpolation    (WS90/WH90 *_voltage, capacitor volt)
 *
 * The voltage formula is a trivial linear interpolation reimplemented from pyecowitt's
 * `_volt_to_percent` (Apache-2.0 reference only — not copied). Default thresholds 2.4/3.0 V
 * match the donor's wh90 percentage.
 */

export type BatteryKind = 'binary' | 'bar' | 'voltage';

export interface BatteryReading {
  /** Percentage 0-100, or null when the raw value can't be decoded for this kind. */
  readonly percent: number | null;
  /** The original raw battery string. */
  readonly raw: string;
  /** Which encoding was used to decode. */
  readonly kind: BatteryKind;
}

/** Linear voltage -> percent, rounded and clamped to 0-100. */
export function voltToPercent(volts: number, low: number, high: number): number {
  const pct = Math.round(((volts - low) / (high - low)) * 100);
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/** Decode a binary battery flag: "0" => 100%, "1" => 10%. */
export function decodeBinaryBattery(raw: string): BatteryReading {
  const trimmed = raw.trim();
  if (trimmed === '0') return { percent: 100, raw, kind: 'binary' };
  if (trimmed === '1') return { percent: 10, raw, kind: 'binary' };
  return { percent: null, raw, kind: 'binary' };
}

/** Decode a 0-5 "bar" battery level: percent = level * 20, clamped to 100. */
export function decodeBarBattery(raw: string): BatteryReading {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { percent: null, raw, kind: 'bar' };
  const pct = Math.min(Number(trimmed) * 20, 100);
  return { percent: pct, raw, kind: 'bar' };
}

/** Decode a voltage battery (volts -> percent). Defaults to the 2.4-3.0 V window. */
export function decodeVoltageBattery(raw: string, low = 2.4, high = 3.0): BatteryReading {
  const trimmed = raw.trim();
  const volts = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(volts)) {
    return { percent: null, raw, kind: 'voltage' };
  }
  return { percent: voltToPercent(volts, low, high), raw, kind: 'voltage' };
}
