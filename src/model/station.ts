/**
 * The unified Station aggregate both transports converge to.
 *
 * Poll readings (`ResolvedReading`) key by hardware id (stable across battery swaps) or, for the
 * gateway-owned indoor keys, under a synthetic `gateway` owner. Push readings (`PushDecodeResult`)
 * key by `passkey` + channel/group (push has no hardware id). Battery readings are NOT surfaced as
 * their own sensors: they decorate the owning measurement sensor's `battery`/`batteryUnit`, using
 * the value the transport already produced (percent or volts) — the model never re-decodes.
 *
 * Updates merge immutably (`mergeSensor`) and `ingest*` returns the list of sensors whose value or
 * battery actually changed, so the facade can emit `sensorChanged` precisely.
 */

import { mergeSensor, type BatteryUnit, type Sensor, type SensorUpdate } from './sensor.js';
import { classifyKey } from './quantity.js';
import type { ResolvedReading } from '../local/poller.js';
import type { MappedSensor } from '../local/sensor-mapper.js';
import type { PushDecodeResult } from '../push/ecowitt-form.js';

/**
 * Read-only seam the station needs from the SensorMapper (model/channel/signal for a reading).
 *
 * `getSensorInfoForKey` resolves per live key, which is correct even when two physical sensors
 * share the same gateway short hardware id; `getSensorInfo` (per raw id) is the fallback for
 * force-attributed readings whose key is not registered to any model's key set.
 */
export interface SensorInfoLookup {
  getSensorInfo(hardwareId: string): MappedSensor | undefined;
  getSensorInfoForKey(liveKey: string): MappedSensor | undefined;
}

const GATEWAY_OWNER = 'gateway';

/** Immutable point-in-time snapshot of the whole station. */
export interface StationSnapshot {
  readonly sensors: ReadonlyArray<Sensor>;
}

function signalToNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) ? n : undefined;
}

export class Station {
  private readonly sensors = new Map<string, Sensor>();

  /** Ingest a poll batch; key by hardwareId/gateway; returns the changed sensors. */
  ingestPollReadings(
    readings: ReadonlyArray<ResolvedReading>,
    lookup: SensorInfoLookup,
    now: number,
  ): Sensor[] {
    const changed: Sensor[] = [];
    // Two passes: measurements first (so a battery can find its owner), then batteries.
    for (const r of readings) {
      const cls = classifyKey(r.key);
      if (cls.kind !== 'measurement') continue;
      const owner = r.hardwareId;
      // Resolve sensor info per live KEY (correct under shared short hardware ids); fall back to
      // the per-owner lookup for force-attributed readings whose key isn't in a model's key set.
      const info =
        lookup.getSensorInfoForKey(r.key) ??
        (owner !== undefined ? lookup.getSensorInfo(owner) : undefined);
      const id = `${owner ?? GATEWAY_OWNER}:${r.key}`;
      const signal = signalToNumber(info?.signal);
      this.upsert(
        id,
        {
          id,
          ...(owner !== undefined ? { hardwareId: owner } : {}),
          ...(info?.model ? { model: info.model } : {}),
          ...(info?.channel !== undefined ? { channel: info.channel } : {}),
          quantity: cls.quantity,
          value: r.value,
          unit: r.unit,
          raw: r.raw,
          ...(signal !== undefined ? { signal } : {}),
          lastUpdated: now,
        },
        { value: r.value, unit: r.unit, raw: r.raw, lastUpdated: now },
        changed,
      );
    }
    for (const r of readings) {
      const cls = classifyKey(r.key);
      if (cls.kind !== 'battery') continue;
      this.applyBattery(r.hardwareId ?? GATEWAY_OWNER, r.value, cls.batteryUnit, now, changed);
    }
    return changed;
  }

  /** Ingest a decoded push body; key by passkey + channel/group; returns changed sensors. */
  ingestPushResult(result: PushDecodeResult, now: number): Sensor[] {
    const changed: Sensor[] = [];
    const passkey = result.passkey ?? 'push';
    // Pass 1: measurements (a push reading with a numeric `battery` is a battery field).
    for (const r of result.readings) {
      if (r.battery !== undefined) continue; // percent batteries handled in pass 2
      const cls = classifyKey(r.key);
      if (cls.kind === 'battery') continue; // voltage battery (unit V) handled in pass 2
      if (cls.kind !== 'measurement') continue;
      const owner = this.pushOwner(passkey, r.channel);
      const id = `${owner}:${r.key}`;
      this.upsert(
        id,
        {
          id,
          ...(r.channel !== undefined ? { channel: r.channel } : {}),
          quantity: cls.quantity,
          value: r.value,
          unit: r.unit,
          raw: r.raw,
          lastUpdated: now,
        },
        { value: r.value, unit: r.unit, raw: r.raw, lastUpdated: now },
        changed,
      );
    }
    // Pass 2: batteries — percent (PushReading.battery set) or raw voltage (scalar unit 'V').
    for (const r of result.readings) {
      const pct = r.battery;
      if (pct !== undefined) {
        this.applyPushBattery(passkey, r.channel, pct, '%', now, changed);
        continue;
      }
      if (classifyKey(r.key).kind === 'battery' && r.unit === 'V') {
        this.applyPushBattery(passkey, r.channel, r.value, 'V', now, changed);
      }
    }
    return changed;
  }

  /** Immutable snapshot of all sensors. */
  getSensors(): Sensor[] {
    return [...this.sensors.values()];
  }

  /** Frozen snapshot of the station (sensors are immutable value objects). */
  getStation(): StationSnapshot {
    return Object.freeze({ sensors: this.getSensors() });
  }

  private pushOwner(passkey: string, channel: number | undefined): string {
    return channel !== undefined ? `${passkey}:ch${String(channel)}` : `${passkey}:station`;
  }

  private applyPushBattery(
    passkey: string,
    channel: number | undefined,
    battery: number,
    batteryUnit: BatteryUnit,
    now: number,
    changed: Sensor[],
  ): void {
    const owner = this.pushOwner(passkey, channel);
    for (const [id, sensor] of this.sensors) {
      if (!id.startsWith(`${owner}:`)) continue;
      const next = mergeSensor(sensor, { battery, batteryUnit, lastUpdated: now });
      this.sensors.set(id, next);
      if (sensor.battery !== battery) changed.push(next);
    }
  }

  protected upsert(id: string, create: Sensor, update: SensorUpdate, changed: Sensor[]): void {
    const existing = this.sensors.get(id);
    if (existing === undefined) {
      this.sensors.set(id, create);
      changed.push(create);
      return;
    }
    const next = mergeSensor(existing, update);
    // Always re-store so lastUpdated/raw stay fresh; only flag a change on value/battery delta.
    this.sensors.set(id, next);
    if (next.value !== existing.value || next.battery !== existing.battery) {
      changed.push(next);
    }
  }

  /** Decorate every sensor owned by `owner` with a battery (percent or volts) — never re-decodes. */
  protected applyBattery(
    owner: string,
    battery: number,
    batteryUnit: BatteryUnit,
    now: number,
    changed: Sensor[],
  ): void {
    for (const [id, sensor] of this.sensors) {
      const sensorOwner = sensor.hardwareId ?? GATEWAY_OWNER;
      if (sensorOwner !== owner) continue;
      const next = mergeSensor(sensor, { battery, batteryUnit, lastUpdated: now });
      this.sensors.set(id, next);
      if (sensor.battery !== battery) changed.push(next);
    }
  }
}
