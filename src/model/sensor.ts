/**
 * The unified sensor value type both transports converge to, plus a pure immutable merge.
 *
 * A `Sensor` is one measurement channel with a stable identity (`id`): for poll it is derived
 * from the hardware id + live key, for push from `passkey` + channel + key. `value`/`unit` are
 * SI (both transports normalize upstream); `raw` is the original string. `battery` is a number
 * carried with a `batteryUnit` discriminator ('%' for an already-decoded percent, 'V' for a raw
 * voltage) so the model NEVER double-decodes a battery (see the model battery reconciliation).
 */

import type { Quantity } from '../protocol/hex-ids.js';
import type { SensorCategory } from '../protocol/sensor-models.js';

/** Battery value discriminator: a decoded percent, or a raw voltage. */
export type BatteryUnit = '%' | 'V';

export interface Sensor {
  /** Stable identity within a Station (transport-derived, deterministic). */
  readonly id: string;
  /** Sensor hardware id (poll only; absent for push and for gateway-owned readings). */
  readonly hardwareId?: string;
  /** Model token (e.g. "wh31", "ws90") when known from the sensor map. */
  readonly model?: string;
  /** Channel (1..8) for per-channel sensors. */
  readonly channel?: number;
  /** Self-describing logical grouping derived from `model` (see `categoryForModel`):
   *  'gateway' | 'weather-station' | 'channel-sensor' | 'external'. Lets a consumer split a
   *  single gateway into logical devices without maintaining its own model→group table. */
  readonly category?: SensorCategory;
  /** Specific measurement name when known from the hex-id table (e.g. "Outdoor
   *  Temperature", "Dewpoint Temperature", "Wind Gust") — distinguishes sensors
   *  that share a `quantity`. Absent for named/pattern keys. */
  readonly name?: string;
  /** Normalized physical quantity. */
  readonly quantity: Quantity;
  /** SI value. */
  readonly value: number;
  /** SI unit string ("°C", "m/s", "hPa", "mm", "%", "W/m²", ""). */
  readonly unit: string;
  /** Original raw reading string. */
  readonly raw: string;
  /** Battery level: percent when batteryUnit==='%', volts when batteryUnit==='V'. */
  readonly battery?: number;
  /** Discriminates `battery` as a percent vs a raw voltage. */
  readonly batteryUnit?: BatteryUnit;
  /** Signal strength (0..4) when known from the sensor map. */
  readonly signal?: number;
  /** Epoch millis of the last update for this sensor. */
  readonly lastUpdated: number;
}

/** Fields that may change on an update (identity + quantity are fixed once created). */
export type SensorUpdate = Partial<
  Pick<
    Sensor,
    | 'value'
    | 'unit'
    | 'raw'
    | 'battery'
    | 'batteryUnit'
    | 'signal'
    | 'model'
    | 'channel'
    | 'lastUpdated'
  >
>;

/** Return a NEW Sensor with `update` applied over `current` (never mutates `current`). */
export function mergeSensor(current: Sensor, update: SensorUpdate): Sensor {
  return { ...current, ...update };
}
