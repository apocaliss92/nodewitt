/**
 * Shared field-extraction + value/battery helpers for the live-data decoders.
 *
 * Extracted so `livedata.ts` and `livedata-channels.ts` share one implementation of the
 * value/unit parsing (P1 `parseValue`) and the donor's battery-percent rule. Every reading is
 * built through `makeReading`, which delegates numeric/unit normalization to `parseValue` and
 * returns `undefined` for a value that is not numeric (e.g. a lightning timestamp) so the decoder
 * skips it instead of crashing — mirroring the donor's tolerant final loop.
 */

import { parseValue } from '../protocol/parse-value.js';
import type { LiveReading } from './livedata.js';

/** Read a record field as a trimmed string (numbers stringified); undefined when absent/null. */
export function str(item: Record<string, unknown>, field: string): string | undefined {
  const v = item[field];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

/** Parse a non-negative integer string, or undefined when not a pure-digit token. */
export function num(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

/** Strip a trailing percent sign (donor `.replace("%", "")`). */
export function stripPercent(raw: string | undefined): string {
  return (raw ?? '').replace('%', '').trim();
}

/**
 * Bar-or-binary battery percent as a string (donor `*20` / binary rule).
 * binary=true: "0" -> "100", "1" -> "10"; otherwise digits -> min(n*20, 100), else raw.
 */
export function batteryPercent(raw: string, binary: boolean): string {
  const trimmed = raw.trim();
  if (binary && trimmed === '0') return '100';
  if (binary && trimmed === '1') return '10';
  const n = num(trimmed);
  if (n !== undefined) return String(Math.min(n * 20, 100));
  return trimmed;
}

/**
 * Build a `LiveReading` via P1 `parseValue`. Returns `undefined` when the value is empty or
 * non-numeric (the donor skips such items in its final loop). `forceId`, when set, attaches the
 * rain/piezo `_force_hardware_id` overlap resolution.
 */
export function makeReading(
  key: string,
  val: string,
  unit?: string,
  forceId?: string,
): LiveReading | undefined {
  if (val.trim() === '') return undefined;
  try {
    const parsed = unit !== undefined ? parseValue({ val, unit }) : parseValue(val);
    return {
      key,
      value: parsed.value,
      unit: parsed.unit,
      raw: parsed.raw,
      ...(forceId !== undefined ? { forceHardwareId: forceId } : {}),
    };
  } catch {
    return undefined;
  }
}
