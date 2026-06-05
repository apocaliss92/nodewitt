/**
 * Pure decoder: an Ecowitt push (Wunderground-style) flat key/value map -> unified readings.
 *
 * Independent implementation of Ecowitt's DOCUMENTED push protocol. The field names are factual
 * protocol data; the imperial->SI conversions and battery math are reused from the P1 primitives
 * (`protocol/parse-value.ts` / `protocol/battery.ts`). The Apache-2.0 `pyecowitt` / `homeassistant_ecowitt`
 * sources were read to learn WHICH fields exist + their units + battery encodings — NOT copied.
 *
 * Output `PushReading` shares the poll transport's `LiveReading` core (`key`/`value`/`unit`/`raw`)
 * so P4 can unify both transports; push identity is `passkey` + optional `channel` (push has no
 * hardware id). This function performs no I/O.
 */

import { parseValue } from '../protocol/parse-value.js';
import {
  decodeBarBattery,
  decodeBinaryBattery,
  decodeVoltageBattery,
} from '../protocol/battery.js';

/** A single decoded push reading. Core fields mirror the poll transport's `LiveReading`. */
export interface PushReading {
  /** Canonical Ecowitt field key (e.g. "tempf", "humidity", "pm25_ch1", "wh65batt"). */
  readonly key: string;
  /** SI-normalized numeric value. */
  readonly value: number;
  /** SI unit string ("°C", "m/s", "hPa", "mm", "%", "µg/m³", ""). */
  readonly unit: string;
  /** Original, unmodified field value as received. */
  readonly raw: string;
  /** Channel number when the field is per-channel (1..8), else undefined. */
  readonly channel?: number;
  /** Battery percent (0-100) when this reading is a decoded battery field, else undefined. */
  readonly battery?: number;
}

/** Station-level metadata extracted from the push body (never a sensor reading). */
export interface PushStationInfo {
  readonly stationtype?: string;
  readonly model?: string;
  readonly freq?: string;
  readonly dateutc?: string;
}

/** Decoded result: station identity + metadata + the flat reading list. */
export interface PushDecodeResult {
  /** Station identity from `PASSKEY` (push has no per-sensor hardware id). */
  readonly passkey?: string;
  readonly station: PushStationInfo;
  readonly readings: PushReading[];
}

// Keys that are station metadata / identity, never emitted as readings.
const METADATA_KEYS = new Set([
  'PASSKEY',
  'stationtype',
  'model',
  'freq',
  'dateutc',
  'runtime',
  'interval',
]);

/**
 * Scalar (non-channel) measurement fields → the unit token fed to `parseValue`.
 *
 * `parseValue('{val}', unit)` strips/normalizes; e.g. unit "F" -> °C, "mph" -> m/s, "inhg" -> hPa,
 * "in" -> mm, "in/hr" -> mm/Hr (these tokens are already in P1's CONVERSIONS). Dimensionless fields
 * use a plain unit string ("%", "W/m²", "", "deg") that parseValue passes through unchanged.
 */
const SCALAR_FIELDS: Record<string, string> = {
  // indoor (WH25 / gateway)
  tempinf: 'F',
  humidityin: '%',
  baromrelin: 'inhg',
  baromabsin: 'inhg',
  // outdoor (WH65 / WS array)
  tempf: 'F',
  humidity: '%',
  winddir: 'deg',
  windspeedmph: 'mph',
  windgustmph: 'mph',
  maxdailygust: 'mph',
  solarradiation: 'W/m²',
  uv: '',
  // rain — tipping bucket
  rainratein: 'in/hr',
  eventrainin: 'in',
  hourlyrainin: 'in',
  dailyrainin: 'in',
  weeklyrainin: 'in',
  monthlyrainin: 'in',
  yearlyrainin: 'in',
  totalrainin: 'in',
  // rain — piezo
  rrain_piezo: 'in/hr',
  erain_piezo: 'in',
  hrain_piezo: 'in',
  drain_piezo: 'in',
  wrain_piezo: 'in',
  mrain_piezo: 'in',
  yrain_piezo: 'in',
  // lightning (WH57)
  lightning_num: '',
  lightning: 'km',
  lightning_time: '',
  // WS90 super-capacitor voltage — a raw voltage reading, NOT a battery percent.
  ws90cap_volt: 'V',
  // CO2/AQ scalar parts (WH45) — channel-less
  co2: '',
  co2_24h: '',
  humi_co2: '%',
  tf_co2: 'F',
  pm25_co2: 'µg/m³',
  pm10_co2: 'µg/m³',
};

/** Build a reading from a raw value via P1 parseValue; returns undefined for empty/non-numeric. */
function makeScalarReading(key: string, raw: string, unitToken: string): PushReading | undefined {
  if (raw.trim() === '') return undefined;
  try {
    const parsed = parseValue({ val: raw, unit: unitToken });
    return { key, value: parsed.value, unit: parsed.unit, raw };
  } catch {
    return undefined;
  }
}

/** Per-channel field patterns: regex (capturing the channel) + the parseValue unit token. */
const CHANNEL_FIELDS: ReadonlyArray<{ readonly re: RegExp; readonly unit: string }> = [
  { re: /^temp(\d)f$/, unit: 'F' }, // WH31 temperature, channel 1..8
  { re: /^humidity(\d)$/, unit: '%' }, // WH31 humidity, channel 1..8
  { re: /^soilmoisture(\d)$/, unit: '%' }, // WH51 soil moisture
  { re: /^tf_ch(\d)$/, unit: 'F' }, // WN34 soil temperature
  { re: /^pm25_ch(\d)$/, unit: 'µg/m³' }, // WH41 PM2.5 live
  { re: /^pm25_avg_24h_ch(\d)$/, unit: 'µg/m³' }, // WH41 PM2.5 24h avg
  { re: /^leak_ch(\d)$/, unit: '' }, // WH55 leak state (0/1)
];

/** Try to decode a per-channel measurement field; undefined when the key matches none. */
function decodeChannelField(key: string, raw: string): PushReading | undefined {
  for (const { re, unit } of CHANNEL_FIELDS) {
    const m = re.exec(key);
    if (m === null || m[1] === undefined) continue;
    const channel = Number(m[1]);
    if (raw.trim() === '') return undefined;
    try {
      const parsed = parseValue({ val: raw, unit });
      return { key, value: parsed.value, unit: parsed.unit, raw, channel };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Battery field family -> which P1 decoder + how to read its channel. */
type BatteryKind = 'binary' | 'bar' | 'voltage';

interface BatteryMatch {
  readonly kind: BatteryKind;
  readonly channel?: number;
}

// Whole-station binary batteries (0 = full, 1 = low).
const BINARY_BATT = new Set([
  'wh25batt',
  'wh26batt',
  'wh40batt',
  'wh57batt',
  'wh65batt',
  'wh68batt',
  'wh80batt',
]);

// Channelized 0-5 "bar" batteries (percent = level * 20).
const BAR_BATT_CHANNEL = /^(?:soilbatt|pm25batt|leakbatt|tf_batt|batt)(\d)$/;

/** Classify a battery field, or undefined when the key is not a battery. */
function classifyBattery(key: string): BatteryMatch | undefined {
  if (BINARY_BATT.has(key)) return { kind: 'binary' };
  // `ws90cap_volt` is intentionally NOT here: it is a raw capacitor voltage (emitted via the
  // scalar table with unit "V"), not a battery percent. Only `wh90batt` is a voltage battery.
  if (key === 'wh90batt') return { kind: 'voltage' };
  const m = BAR_BATT_CHANNEL.exec(key);
  if (m !== null && m[1] !== undefined) return { kind: 'bar', channel: Number(m[1]) };
  return undefined;
}

/** Decode a battery field to a percent PushReading; undefined when undecodable. */
function decodeBatteryField(key: string, raw: string): PushReading | undefined {
  const match = classifyBattery(key);
  if (match === undefined) return undefined;
  const decoded =
    match.kind === 'binary'
      ? decodeBinaryBattery(raw)
      : match.kind === 'bar'
        ? decodeBarBattery(raw)
        : decodeVoltageBattery(raw); // defaults 2.4..3.0 V window (matches P1)
  if (decoded.percent === null) return undefined;
  return {
    key,
    value: decoded.percent,
    unit: '%',
    raw,
    battery: decoded.percent,
    ...(match.channel !== undefined ? { channel: match.channel } : {}),
  };
}

/** Decode a flat push form map into station metadata + unified readings. Tolerates unknown keys. */
export function decodePushForm(form: Readonly<Record<string, string>>): PushDecodeResult {
  const readings: PushReading[] = [];
  for (const [key, value] of Object.entries(form)) {
    if (METADATA_KEYS.has(key)) continue;

    // Battery check FIRST so `tf_batt{n}` is not mis-read as a `tf_` soil-temp measurement.
    const batteryReading = decodeBatteryField(key, value);
    if (batteryReading !== undefined) {
      readings.push(batteryReading);
      continue;
    }

    const scalarUnit = Object.prototype.hasOwnProperty.call(SCALAR_FIELDS, key)
      ? SCALAR_FIELDS[key]
      : undefined;
    if (scalarUnit !== undefined) {
      const reading = makeScalarReading(key, value, scalarUnit);
      if (reading !== undefined) readings.push(reading);
      continue;
    }

    const channelReading = decodeChannelField(key, value);
    if (channelReading !== undefined) {
      readings.push(channelReading);
      continue;
    }
    // unknown keys are ignored.
  }

  const station: PushStationInfo = {
    ...(form.stationtype !== undefined ? { stationtype: form.stationtype } : {}),
    ...(form.model !== undefined ? { model: form.model } : {}),
    ...(form.freq !== undefined ? { freq: form.freq } : {}),
    ...(form.dateutc !== undefined ? { dateutc: form.dateutc } : {}),
  };

  return {
    ...(form.PASSKEY !== undefined ? { passkey: form.PASSKEY } : {}),
    station,
    readings,
  };
}
