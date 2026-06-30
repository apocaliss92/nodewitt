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
import type { GatewayVersion, SensorInfo } from './endpoints.js';

const DEFAULT_SCAN_MS = 60_000;
const DEFAULT_MAPPING_MS = 600_000;

/** Gateway-owned indoor keys: these never receive a sensor hardware id (donor GATEWAY_SENSORS). */
const GATEWAY_KEYS = new Set(['tempinf', 'humidityin', 'baromabsin', 'baromrelin']);

/** The subset of `Endpoints` the poller consumes (typed seam — injectable in tests). */
export interface PollerEndpoints {
  getLiveData(): Promise<RawLiveData>;
  getAllSensors(): Promise<SensorInfo[]>;
  getUnits(): Promise<Record<string, unknown>>;
  getVersion(): Promise<GatewayVersion>;
}

/** A decoded reading with its resolved owner (a hardware id, or `undefined` for gateway keys). */
export interface ResolvedReading extends LiveReading {
  readonly hardwareId: string | undefined;
}

/** Lightweight gateway identity captured from `/get_version`. */
export interface PollerStationInfo {
  readonly model?: string;
  readonly firmware?: string;
}

export interface LocalPollerOptions {
  readonly endpoints: PollerEndpoints;
  readonly scanIntervalMs?: number;
  readonly mappingIntervalMs?: number;
  readonly onReadings: (readings: ResolvedReading[]) => void;
  readonly onError: (error: unknown) => void;
  /** Optional raw-frame sink: the unmodified `/get_livedata_info` object per poll (diagnostics). */
  readonly onRawFrame?: (raw: RawLiveData) => void;
}

export class LocalPoller {
  private readonly mapper = new SensorMapper();
  private scanTimer: ReturnType<typeof setInterval> | undefined;
  private mappingTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;
  // Withhold-until-ready gate: a live poll resolves each reading's owner (and
  // thus the sensor's stable id + model/channel) against the sensor map. The map
  // is primed by `refreshMapping`. Until the FIRST successful prime, a sensor's
  // owner would fall back to the gateway and its model/channel would be absent —
  // i.e. an INCOMPLETE sensor. Because a sensor's identity is fixed at create
  // time and never re-derived downstream, emitting that incomplete reading would
  // permanently freeze a generic name. So the poller WITHHOLDS every poll batch
  // (never calls `onReadings`) until the map has been primed at least once. The
  // schedule keeps running; the first successful prime unblocks emission. Atomic:
  // either a fully-resolved batch or nothing — never a partial-then-heal.
  private mappingPrimed = false;
  // Gateway temperature unit for channelized temps. Donor: get_units_info "temperature"
  // (fallback "temp"); "0" -> Celsius, any other value -> Fahrenheit. Default 'C'.
  private gatewayTempUnit = 'C';
  // Gateway identity, captured on each mapping refresh from /get_version. Best-effort.
  private stationInfo: PollerStationInfo = {};

  constructor(private readonly opts: LocalPollerOptions) {}

  /** Gateway identity (model/firmware) captured from the last `/get_version`. Best-effort. */
  getStationInfo(): PollerStationInfo {
    return this.stationInfo;
  }

  /**
   * The poller's own primed `SensorMapper`, exposed as a read-only `getSensorInfo` lookup so the
   * facade/`Station` share the SAME mapper the poller refreshes — no duplicate `getAllSensors`
   * fetch and no model/channel/signal drift. The mapper is primed on `start()`/`refreshMapping`.
   */
  getMapper(): {
    getSensorInfo(hardwareId: string): MappedSensor | undefined;
    getSensorInfoForKey(liveKey: string): MappedSensor | undefined;
  } {
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
    // Re-arm the withhold gate: a restart must re-prime before emitting again, so
    // a fresh run never surfaces a batch resolved against the previous map.
    this.mappingPrimed = false;
  }

  /** Re-read the gateway unit + sensor list and rebuild the live-key -> hardware-id mapping. Offline-tolerant. */
  private async refreshMapping(): Promise<void> {
    try {
      const units = await this.opts.endpoints.getUnits();
      const code = units['temperature'] ?? units['temp'];
      this.gatewayTempUnit = String(code) === '0' ? 'C' : 'F';
      const version = await this.opts.endpoints.getVersion();
      this.stationInfo = {
        ...(version.stationtype !== undefined ? { model: version.stationtype } : {}),
        ...(version.version !== undefined ? { firmware: version.version } : {}),
      };
      const sensors = await this.opts.endpoints.getAllSensors();
      this.mapper.updateMapping(sensors);
      // The map is now primed: subsequent polls resolve complete sensor identities,
      // so emission is unblocked (withhold-until-ready). Idempotent once set.
      this.mappingPrimed = true;
    } catch (error) {
      this.opts.onError(error);
    }
  }

  /** Fetch + decode + resolve a single live-data snapshot, then emit it. Offline-tolerant. */
  private async poll(): Promise<void> {
    try {
      // If the FIRST mapping refresh failed (gateway powering up), retry it here so
      // recovery happens on the next scan tick rather than waiting a full mapping
      // cadence (~10 min). Cheap once primed: the guard skips the re-fetch.
      if (!this.mappingPrimed) await this.refreshMapping();
      const raw = await this.opts.endpoints.getLiveData();
      this.opts.onRawFrame?.(raw);
      const decoded = decodeLiveData(raw, this.mapper, {}, this.gatewayTempUnit);
      const resolved: ResolvedReading[] = decoded.map((reading) => ({
        ...reading,
        hardwareId: GATEWAY_KEYS.has(reading.key)
          ? undefined
          : (reading.forceHardwareId ?? this.mapper.getHardwareId(reading.key)),
      }));
      // Withhold-until-ready: do not surface a batch resolved against an unprimed
      // map — its sensors would carry incomplete (gateway-fallback, model/channel-
      // less) identities that downstream can never heal. The next poll after the
      // first successful mapping refresh emits a complete batch.
      if (!this.mappingPrimed) return;
      this.opts.onReadings(resolved);
    } catch (error) {
      this.opts.onError(error);
    }
  }
}
