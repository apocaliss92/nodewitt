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

const DEAD_IDS = new Set(['FFFFFFFF', 'FFFFFFFE']);
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

  updateMapping(sensors: ReadonlyArray<RawSensorInfo>): void {
    this.hardwareByKey = new Map();
    this.signalByKey = new Map();
    this.infoById = new Map();

    for (const sensor of sensors) {
      const hardwareId = sensor.id.trim();
      if (!hardwareId || DEAD_IDS.has(hardwareId.toUpperCase())) continue;

      const model = (sensor.img ?? '').trim();
      const channel = extractChannel(sensor.name ?? '');
      const signal = parseSignal(sensor.signal);

      this.infoById.set(hardwareId, {
        hardwareId,
        model,
        channel,
        battery: String(sensor.batt ?? ''),
        signal: String(sensor.signal ?? ''),
      });

      for (const key of liveDataKeysForModel(model, channel)) {
        const existing = this.signalByKey.get(key);
        if (existing === undefined || signal >= existing) {
          this.hardwareByKey.set(key, hardwareId);
          this.signalByKey.set(key, signal);
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

  getAllHardwareIds(): string[] {
    return [...this.infoById.keys()];
  }
}
