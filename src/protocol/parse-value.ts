/**
 * Value/unit parser that normalizes Ecowitt readings to SI.
 *
 * Accepts either a split `{ val, unit }` pair or a single string with an inline unit suffix
 * (e.g. "2.24 mph", "1013.2 hPa", "62%"). Strips the unit, parses the numeric part, converts
 * to SI, and returns the SI value + SI unit + the original raw string. Non-numeric input
 * throws a clear error — it never yields NaN.
 *
 * Conversion factors are public physical constants (reimplemented from pyecowitt.convert_units,
 * Apache-2.0 reference only — not copied).
 */

export interface ParsedValue {
  /** The numeric value normalized to SI. */
  readonly value: number;
  /** The SI unit string (e.g. "°C", "m/s", "hPa", "mm", "%", ""). */
  readonly unit: string;
  /** The original, unmodified input rendered as a string. */
  readonly raw: string;
}

/** Split value/unit input shape (as the gateway sometimes emits). */
export interface ValueUnit {
  readonly val: string | number;
  readonly unit?: string;
}

// Inline-unit splitter: numeric part + trailing unit. Mirrors the donor regex.
const INLINE = /^([-+]?\d*\.?\d+)\s*([a-zA-Z%°/µ²·]+.*)?$/;

interface Conversion {
  readonly to: string;
  readonly convert: (n: number) => number;
}

// Map a raw (lowercased, trimmed) unit token to its SI target + conversion.
const CONVERSIONS: Record<string, Conversion> = {
  '°f': { to: '°C', convert: (n) => (n - 32) / 1.8 },
  degf: { to: '°C', convert: (n) => (n - 32) / 1.8 },
  f: { to: '°C', convert: (n) => (n - 32) / 1.8 },
  mph: { to: 'm/s', convert: (n) => n * 0.44707 },
  'km/h': { to: 'm/s', convert: (n) => n / 3.6 },
  kmh: { to: 'm/s', convert: (n) => n / 3.6 },
  inhg: { to: 'hPa', convert: (n) => n * 33.8639 },
  in: { to: 'mm', convert: (n) => n * 25.4 },
  'in/hr': { to: 'mm/Hr', convert: (n) => n * 25.4 },
  inch: { to: 'mm', convert: (n) => n * 25.4 },
  mi: { to: 'km', convert: (n) => n * 1.609344 },
  mile: { to: 'km', convert: (n) => n * 1.609344 },
};

function splitInline(raw: string): { numeric: string; unit: string } {
  const match = INLINE.exec(raw.trim());
  if (!match || match[1] === undefined) {
    throw new Error(`parseValue: non-numeric value: ${JSON.stringify(raw)}`);
  }
  return { numeric: match[1], unit: (match[2] ?? '').trim() };
}

function toNumber(numeric: string, raw: string): number {
  const n = Number(numeric);
  if (!Number.isFinite(n)) {
    throw new Error(`parseValue: non-numeric value: ${JSON.stringify(raw)}`);
  }
  return n;
}

function normalize(n: number, unit: string): { value: number; unit: string } {
  const token = unit.trim().toLowerCase();
  const conv = Object.prototype.hasOwnProperty.call(CONVERSIONS, token)
    ? CONVERSIONS[token]
    : undefined;
  if (conv) {
    return { value: conv.convert(n), unit: conv.to };
  }
  // Already SI / dimensionless: keep the unit as written (preserve "°C", "W/m²", "%", "").
  return { value: n, unit: unit.trim() };
}

/** Parse + SI-normalize a reading. Throws on non-numeric input (never NaN). */
export function parseValue(input: string | ValueUnit): ParsedValue {
  if (typeof input === 'string') {
    const raw = input;
    const { numeric, unit } = splitInline(raw);
    const n = toNumber(numeric, raw);
    const si = normalize(n, unit);
    return { value: si.value, unit: si.unit, raw };
  }

  const raw = `${input.val}${input.unit ? ` ${input.unit}` : ''}`;
  const valStr = String(input.val).trim();
  const n = toNumber(valStr, raw);
  const si = normalize(n, input.unit ?? '');
  return { value: si.value, unit: si.unit, raw };
}
