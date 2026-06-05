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

/** Read-only seam the station needs from the SensorMapper (model/channel/signal for an id). */
export interface SensorInfoLookup {
  getSensorInfo(hardwareId: string): MappedSensor | undefined;
}

const GATEWAY_OWNER = 'gateway';

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
      const info = owner !== undefined ? lookup.getSensorInfo(owner) : undefined;
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

  /** Immutable snapshot of all sensors. */
  getSensors(): Sensor[] {
    return [...this.sensors.values()];
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
