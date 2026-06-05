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

/** Decode a flat push form map into station metadata + unified readings. Tolerates unknown keys. */
export function decodePushForm(form: Readonly<Record<string, string>>): PushDecodeResult {
  const readings: PushReading[] = [];
  // Placeholder body filled in by later tasks; for now only metadata is split out.
  for (const [key, value] of Object.entries(form)) {
    if (METADATA_KEYS.has(key)) continue;
    // Known measurement / battery decoding is added in Tasks 3.2-3.5; unknown keys are ignored.
    void value;
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

// Re-exported for the measurement tables added next; keeps the imports "used" until then.
export { parseValue, decodeBarBattery, decodeBinaryBattery, decodeVoltageBattery };
