/**
 * Map gateway live-data keys to stable sensor hardware IDs.
 *
 * Ported from the MIT `ecowitt_local` `sensor_mapper.py` `SensorMapper`. From each entry in
 * `/get_sensors_info`, the model image (`img`) + the channel parsed from the name (`CH(\d+)`)
 * yield the live-data keys that model owns (via the P1 `liveDataKeysForModel`); each key is
 * mapped to the sensor's hardware id. When two sensors claim the same key — most often a stale
 * WH65 slot (img=wh69) and an active WH90 both registering common_list 0x02–0x13 — the entry
 * with the stronger signal wins, so the active sensor keeps the key and the stale slot
 * (signal ~0) is ignored.
 */

import { liveDataKeysForModel } from '../protocol/sensor-models.js';
import type { SensorInfo as RawSensorInfo } from './endpoints.js';

const DEAD_IDS = new Set(['FFFFFFFF', 'FFFFFFFE', '00000000']);
const CHANNEL_RE = /CH(\d+)/;

export interface MappedSensor {
  readonly hardwareId: string;
  readonly model: string;
  readonly channel: number | undefined;
  readonly battery: string;
  readonly signal: string;
}

function parseSignal(raw: string | number | undefined): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(n) ? n : -1;
}

function extractChannel(name: string): number | undefined {
  const m = CHANNEL_RE.exec(name);
  return m && m[1] !== undefined ? Number.parseInt(m[1], 10) : undefined;
}

export class SensorMapper {
  private hardwareByKey = new Map<string, string>();
  private signalByKey = new Map<string, number>();
  private infoById = new Map<string, MappedSensor>();
  // Per-live-key sensor info. Unlike `infoById` (keyed by the gateway's short hardware id, which
  // is NOT unique — a GW1100A can report the same id for two physical sensors), this is keyed by
  // the live-data key the sensor owns. Because the per-model key sets are disjoint across the
  // colliding sensors, this resolves each reading to the CORRECT sensor info, while `infoById`
  // would lose one of the two to last-write-wins.
  private infoByKey = new Map<string, MappedSensor>();

  updateMapping(sensors: ReadonlyArray<RawSensorInfo>): void {
    this.hardwareByKey = new Map();
    this.signalByKey = new Map();
    this.infoById = new Map();
    this.infoByKey = new Map();

    for (const sensor of sensors) {
      const hardwareId = sensor.id.trim();
      if (!hardwareId || DEAD_IDS.has(hardwareId.toUpperCase())) continue;

      const model = (sensor.img ?? '').trim();
      const channel = extractChannel(sensor.name ?? '');
      const signal = parseSignal(sensor.signal);

      const info: MappedSensor = {
        hardwareId,
        model,
        channel,
        battery: String(sensor.batt ?? ''),
        signal: String(sensor.signal ?? ''),
      };
      this.infoById.set(hardwareId, info);

      for (const key of liveDataKeysForModel(model, channel)) {
        const existing = this.signalByKey.get(key);
        if (existing === undefined || signal >= existing) {
          this.hardwareByKey.set(key, hardwareId);
          this.signalByKey.set(key, signal);
          // Associate THIS sensor's info with each of its keys, under the same signal-wins
          // policy as `hardwareByKey`, so a per-key lookup yields the owning sensor's model/
          // channel/signal even when two sensors share the raw hardware id.
          this.infoByKey.set(key, info);
        }
      }
    }
  }

  getHardwareId(liveKey: string): string | undefined {
    return this.hardwareByKey.get(liveKey);
  }

  getSensorInfo(hardwareId: string): MappedSensor | undefined {
    return this.infoById.get(hardwareId);
  }

  /**
   * Sensor info for the sensor that OWNS `liveKey`. Resolves correctly even when two physical
   * sensors share the same gateway short hardware id, because their live-key sets are disjoint.
   */
  getSensorInfoForKey(liveKey: string): MappedSensor | undefined {
    return this.infoByKey.get(liveKey);
  }

  getAllHardwareIds(): string[] {
    return [...this.infoById.keys()];
  }
}
