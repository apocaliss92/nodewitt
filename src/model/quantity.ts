/**
 * Classify a transport live key into the model's three buckets: measurement (with a normalized
 * quantity), battery (with a percent-vs-volts discriminator), or unknown (ignored).
 *
 * This is the SINGLE source of truth for "is this key a battery, and is its value already a
 * percent or a raw voltage?" — the poll decoders already convert most batteries to a percent
 * (`batteryPercent` in livedata-channels.ts), while a handful of WS90/WH90/WS85 voltage keys and
 * WH68/WH80 battery keys stay as raw volts. The model classifies, it NEVER re-decodes.
 *
 * Lightning keys map to dedicated `lightning_distance`/`lightning_count` quantities rather than
 * being folded into `precipitation`, so a consumer can distinguish a WH57's distance/strike-count
 * from rain readings.
 */

import { lookupHexId, type Quantity } from '../protocol/hex-ids.js';
import type { BatteryUnit } from './sensor.js';

export type KeyClass =
  | { readonly kind: 'measurement'; readonly quantity: Quantity; readonly name?: string }
  | { readonly kind: 'battery'; readonly batteryUnit: BatteryUnit }
  | { readonly kind: 'unknown' };

// Raw-voltage battery keys: their value is VOLTS, not a percent. (Poll surfaces these unconverted.)
const VOLTAGE_BATTERY_KEYS = new Set(['wh68batt', 'wh80batt']);
const VOLTAGE_SUFFIX = /(?:_voltage|cap_volt)$/;

// Named (non-hex) measurement keys → quantity. soilmoisture/leaf are reported as % (humidity-like).
const NAMED_QUANTITY: Record<string, Quantity> = {
  tempinf: 'temperature',
  tempf: 'temperature',
  humidityin: 'humidity',
  humidity: 'humidity',
  baromrelin: 'pressure',
  baromabsin: 'pressure',
  windspeedmph: 'wind_speed',
  windgustmph: 'wind_speed',
  maxdailygust: 'wind_speed',
  winddir: 'wind_direction',
  solarradiation: 'irradiance',
  uv: 'uv',
  lightning: 'lightning_distance', // WH57 strike distance (km)
  lightning_num: 'lightning_count', // WH57 strike count
};

// Per-channel / patterned measurement keys → quantity.
const PATTERN_QUANTITY: ReadonlyArray<{ readonly re: RegExp; readonly quantity: Quantity }> = [
  { re: /^temp(\d)f$/, quantity: 'temperature' },
  { re: /^humidity(\d)$/, quantity: 'humidity' },
  { re: /^soilmoisture(\d)$/, quantity: 'humidity' },
  { re: /^soiltemp(\d)$/, quantity: 'temperature' },
  { re: /^tf_ch(\d)$/, quantity: 'temperature' },
  { re: /^(?:rainratein|rrain_piezo)$/, quantity: 'precipitation_rate' },
  { re: /rainin$|rain_piezo$/, quantity: 'precipitation' },
];

function isBatteryKey(key: string): BatteryUnit | undefined {
  if (VOLTAGE_BATTERY_KEYS.has(key) || VOLTAGE_SUFFIX.test(key)) return 'V';
  if (/batt(?:\d+)?$/.test(key) || key === 'co2_batt') return '%';
  return undefined;
}

/** Classify a live/push key. Battery check first so e.g. `tf_batt1` is not read as a temperature. */
export function classifyKey(key: string): KeyClass {
  const batteryUnit = isBatteryKey(key);
  if (batteryUnit !== undefined) return { kind: 'battery', batteryUnit };

  const hex = lookupHexId(key);
  // Carry the specific measurement name (e.g. "Outdoor Temperature", "Dewpoint
  // Temperature", "Wind Gust") so consumers can distinguish sensors that share a
  // quantity. Only the hex-id table has these human names; named/pattern keys
  // leave `name` undefined (the consumer falls back to the quantity label).
  if (hex !== undefined) return { kind: 'measurement', quantity: hex.quantity, name: hex.name };

  const named = Object.prototype.hasOwnProperty.call(NAMED_QUANTITY, key)
    ? NAMED_QUANTITY[key]
    : undefined;
  if (named !== undefined) return { kind: 'measurement', quantity: named };

  for (const { re, quantity } of PATTERN_QUANTITY) {
    if (re.test(key)) return { kind: 'measurement', quantity };
  }
  return { kind: 'unknown' };
}
