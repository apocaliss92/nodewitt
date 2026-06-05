/**
 * Two-tier local poller for the Ecowitt gateway.
 *
 * Ported from the MIT `ecowitt_local` coordinator cadence: a fast live-data poll
 * (`scanIntervalMs`, default 60s) plus a slow sensor-map refresh (`mappingIntervalMs`,
 * default 600s). Each live poll fetches `/get_livedata_info`, decodes the sub-arrays
 * (`decodeLiveData`) against the current `SensorMapper`, resolves each reading's hardware id,
 * and emits the batch. The poller is offline-tolerant: a failed poll is reported via `onError`
 * and never stops the schedule — the next tick fires regardless.
 */

import { decodeLiveData, type LiveReading, type RawLiveData } from './livedata.js';
import { SensorMapper, type MappedSensor } from './sensor-mapper.js';
import type { SensorInfo } from './endpoints.js';

const DEFAULT_SCAN_MS = 60_000;
const DEFAULT_MAPPING_MS = 600_000;

/** Gateway-owned indoor keys: these never receive a sensor hardware id (donor GATEWAY_SENSORS). */
const GATEWAY_KEYS = new Set(['tempinf', 'humidityin', 'baromabsin', 'baromrelin']);

/** The subset of `Endpoints` the poller consumes (typed seam — injectable in tests). */
export interface PollerEndpoints {
  getLiveData(): Promise<RawLiveData>;
  getAllSensors(): Promise<SensorInfo[]>;
  getUnits(): Promise<Record<string, unknown>>;
}

/** A decoded reading with its resolved owner (a hardware id, or `undefined` for gateway keys). */
export interface ResolvedReading extends LiveReading {
  readonly hardwareId: string | undefined;
}

export interface LocalPollerOptions {
  readonly endpoints: PollerEndpoints;
  readonly scanIntervalMs?: number;
  readonly mappingIntervalMs?: number;
  readonly onReadings: (readings: ResolvedReading[]) => void;
  readonly onError: (error: unknown) => void;
}

export class LocalPoller {
  private readonly mapper = new SensorMapper();
  private scanTimer: ReturnType<typeof setInterval> | undefined;
  private mappingTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  // Gateway temperature unit for channelized temps. Donor: get_units_info "temperature"
  // (fallback "temp"); "0" -> Celsius, any other value -> Fahrenheit. Default 'C'.
  private gatewayTempUnit = 'C';

  constructor(private readonly opts: LocalPollerOptions) {}

  /**
   * The poller's own primed `SensorMapper`, exposed as a read-only `getSensorInfo` lookup so the
   * facade/`Station` share the SAME mapper the poller refreshes — no duplicate `getAllSensors`
   * fetch and no model/channel/signal drift. The mapper is primed on `start()`/`refreshMapping`.
   */
  getMapper(): { getSensorInfo(hardwareId: string): MappedSensor | undefined } {
    return this.mapper;
  }

  /**
   * Do an immediate mapping refresh + live poll, then arm the two-tier schedule.
   * Rejects if already started: a second `start()` would overwrite the timer refs and leak the
   * originals. Call `stop()` (which resets the started state) before starting again.
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('LocalPoller already started');
    }
    this.started = true;
    await this.refreshMapping();
    await this.poll();
    const scanMs = this.opts.scanIntervalMs ?? DEFAULT_SCAN_MS;
    const mapMs = this.opts.mappingIntervalMs ?? DEFAULT_MAPPING_MS;
    this.scanTimer = setInterval(() => void this.poll(), scanMs);
    this.mappingTimer = setInterval(() => void this.refreshMapping(), mapMs);
  }

  /** Clear both timers and reset the started state. Safe to call when not started. */
  stop(): void {
    if (this.scanTimer !== undefined) clearInterval(this.scanTimer);
    if (this.mappingTimer !== undefined) clearInterval(this.mappingTimer);
    this.scanTimer = undefined;
    this.mappingTimer = undefined;
    this.started = false;
  }

  /** Re-read the gateway unit + sensor list and rebuild the live-key -> hardware-id mapping. Offline-tolerant. */
  private async refreshMapping(): Promise<void> {
    try {
      const units = await this.opts.endpoints.getUnits();
      const code = units['temperature'] ?? units['temp'];
      this.gatewayTempUnit = String(code) === '0' ? 'C' : 'F';
      const sensors = await this.opts.endpoints.getAllSensors();
      this.mapper.updateMapping(sensors);
    } catch (error) {
      this.opts.onError(error);
    }
  }

  /** Fetch + decode + resolve a single live-data snapshot, then emit it. Offline-tolerant. */
  private async poll(): Promise<void> {
    try {
      const raw = await this.opts.endpoints.getLiveData();
      const decoded = decodeLiveData(raw, this.mapper, {}, this.gatewayTempUnit);
      const resolved: ResolvedReading[] = decoded.map((reading) => ({
        ...reading,
        hardwareId: GATEWAY_KEYS.has(reading.key)
          ? undefined
          : (reading.forceHardwareId ?? this.mapper.getHardwareId(reading.key)),
      }));
      this.opts.onReadings(resolved);
    } catch (error) {
      this.opts.onError(error);
    }
  }
}
