import type { Sensor } from '../model/sensor.js';
import { liveDataKeysForModel } from '../protocol/sensor-models.js';
import { classifyKey } from '../model/quantity.js';
import {
  decodeBarBattery,
  decodeBinaryBattery,
  decodeVoltageBattery,
} from '../protocol/battery.js';
import { redact, REDACTED } from './redact.js';
import { LIBRARY_VERSION } from '../support/version.js';
import { DeviceDumpSchema, type DeviceDump } from './dump-format.js';
import type { EcowittEvents, RawFrameSource, StationInfo } from '../api/types.js';
import type { StationSnapshot } from '../model/station.js';

type DumpScalar = string | number | boolean;
type PropertyObservation = DeviceDump['observations']['properties'][string];

interface AccEntry {
  values: DumpScalar[];
  unmapped: DumpScalar[];
  enumName?: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

/** True when an img/model token resolves to NO live-data keys (i.e. unknown to nodewitt). */
function isUnmappedModel(model: string, channel: number | undefined): boolean {
  // Channelized models need a positive channel to enumerate keys; probe with the
  // sensor's channel, falling back to 1 only to test membership (never to fabricate data).
  const probeChannel = channel !== undefined && channel > 0 ? channel : 1;
  return (
    liveDataKeysForModel(model).length === 0 &&
    liveDataKeysForModel(model, probeChannel).length === 0
  );
}

/** True when a key is a battery key whose value none of the three decoders can decode. */
function isUndecodableBattery(key: string, raw: string): boolean {
  if (classifyKey(key).kind !== 'battery') {
    return false;
  }
  return (
    decodeBinaryBattery(raw).percent === null &&
    decodeBarBattery(raw).percent === null &&
    decodeVoltageBattery(raw).percent === null
  );
}

/**
 * Accumulates the per-key observations of a nodewitt station: distinct quantity
 * VALUES under `sensor:<quantity>`, distinct sensor model tokens under
 * `model:<img>` (flagged `unmapped` when the img is not in the protocol tables),
 * and — for raw push frames — unknown measurement keys under `key:<name>` and
 * undecodable battery encodings under `battery:<name>`. Pure + deterministic;
 * NEVER executes a command (nodewitt has none) and NEVER re-decodes a mapped value.
 */
export class SensorAccumulator {
  readonly #entries = new Map<string, AccEntry>();

  /** Record one live Sensor: its quantity value + (if present) its model token. */
  recordSensor(s: Sensor, at: number): void {
    this.#bump(`sensor:${s.quantity}`, s.value, false, at, s.quantity);
    if (s.model !== undefined && s.model !== '') {
      const unmapped = isUnmappedModel(s.model, s.channel);
      this.#bump(`model:${s.model}`, s.model, unmapped, at);
    }
  }

  /** Record one raw push-frame key (opt-in): flags unknown keys + undecodable batteries. */
  recordRawKey(key: string, raw: string, at: number): void {
    const cls = classifyKey(key);
    if (cls.kind === 'unknown') {
      this.#bump(`key:${key}`, key, true, at);
      return;
    }
    if (isUndecodableBattery(key, raw)) {
      this.#bump(`battery:${key}`, key, true, at);
    }
    // mapped measurement/decodable battery keys are not recorded as key:*/battery:* entries
  }

  #bump(key: string, value: DumpScalar, unmapped: boolean, at: number, enumName?: string): void {
    let entry = this.#entries.get(key);
    if (!entry) {
      entry = { values: [], unmapped: [], count: 0, firstSeen: at, lastSeen: at };
      if (enumName !== undefined) {
        entry.enumName = enumName;
      }
      this.#entries.set(key, entry);
    }
    entry.count += 1;
    entry.lastSeen = at;
    if (!entry.values.includes(value)) {
      entry.values.push(value);
    }
    if (unmapped && !entry.unmapped.includes(value)) {
      entry.unmapped.push(value);
    }
  }

  snapshot(): Record<string, PropertyObservation> {
    const out: Record<string, PropertyObservation> = {};
    for (const [key, e] of this.#entries) {
      const base: PropertyObservation = {
        values: [...e.values],
        unmapped: [...e.unmapped],
        count: e.count,
        firstSeen: e.firstSeen,
        lastSeen: e.lastSeen,
      };
      out[key] = e.enumName !== undefined ? { ...base, enum: e.enumName } : base;
    }
    return out;
  }
}

type DumpCatalog = DeviceDump['catalog'];
type CatalogSensor = NonNullable<DumpCatalog['sensors']>[number];

/**
 * Build the STATIC catalog from the live sensors: the distinct `(model, channel)`
 * pairs (sorted by model then channel) + a non-sensitive capability summary of the
 * distinct img tokens + measurement quantities seen. Reads only the observed
 * Sensor list — NEVER queries or commands the gateway. `commands` is omitted
 * (nodewitt exposes no actions).
 */
export function buildCatalog(sensors: ReadonlyArray<Sensor>): DumpCatalog {
  const pairs = new Map<string, CatalogSensor>();
  const models = new Set<string>();
  for (const s of sensors) {
    if (s.model === undefined || s.model === '') {
      continue;
    }
    models.add(s.model);
    const pairKey = `${s.model}|${s.channel ?? ''}`;
    if (!pairs.has(pairKey)) {
      pairs.set(
        pairKey,
        s.channel !== undefined ? { model: s.model, channel: s.channel } : { model: s.model },
      );
    }
  }
  const sensorList = [...pairs.values()].sort((a, b) =>
    a.model === b.model ? (a.channel ?? 0) - (b.channel ?? 0) : a.model < b.model ? -1 : 1,
  );
  const quantities = [...new Set(sensors.map((s) => String(s.quantity)))].sort();
  return {
    sensors: sensorList,
    capabilities: { models: [...models].sort(), quantities },
  };
}

type RawFrame = NonNullable<DeviceDump['observations']['rawFrames']>[number];
const DEFAULT_MAX_RAW_FRAMES = 500;

/** A flat scannable key/value pair extracted from a raw transport frame. */
interface FlatKey {
  readonly key: string;
  readonly value: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * True when a raw-frame field name is itself a SECRET/PII key (mac/passkey/ssid/ip/…). Such keys are
 * dropped from the accumulator so a secret field name never becomes a `key:<name>` property in the
 * dump. Detected by reusing the shared {@link redact} key-scrubber (no duplicate fragment list): a
 * sensitive key collapses a probe value to {@link REDACTED}.
 */
function isSensitiveFrameKey(key: string): boolean {
  const probed = redact({ [key]: 'probe' });
  return isPlainObject(probed) && probed[key] === REDACTED;
}

/**
 * Extract the flat, classifiable `(key, value)` pairs from a raw transport frame so the accumulator
 * can scan them for unmapped measurement keys / undecodable batteries.
 *
 * - A `push` frame is already a flat `Record<string,string>` — every entry is a candidate key.
 * - A `poll` frame is the raw `/get_livedata_info` object: its sub-arrays (`common_list`, `ch_*`,
 *   `rain`, …) hold items. A `common_list`-style item carries its measurement key under `id` (a hex
 *   id like `0x02`); other channel items use named fields. We surface each item's `id` (paired with
 *   `val`) plus any string-keyed scalar field, skipping pure structural keys.
 *
 * Pure + defensive: tolerates any shape (an unexpected payload simply yields no keys).
 */
function extractFrameKeys(source: RawFrameSource, payload: unknown): FlatKey[] {
  const out: FlatKey[] = [];
  const push = (key: string, value: string): void => {
    // Skip secret/PII field names so they never become a `key:<name>` dump property.
    if (!isSensitiveFrameKey(key)) out.push({ key, value });
  };
  if (source === 'push') {
    if (isPlainObject(payload)) {
      for (const [key, value] of Object.entries(payload)) {
        if (typeof value === 'string') push(key, value);
      }
    }
    return out;
  }
  // poll: walk the sub-arrays of the raw livedata envelope.
  if (!isPlainObject(payload)) return out;
  const STRUCTURAL = new Set(['id', 'val', 'unit', 'channel']);
  for (const subArray of Object.values(payload)) {
    if (!Array.isArray(subArray)) continue;
    for (const item of subArray) {
      if (!isPlainObject(item)) continue;
      if (typeof item['id'] === 'string') {
        const val = item['val'];
        push(item['id'], typeof val === 'string' || typeof val === 'number' ? String(val) : '');
      }
      for (const [key, value] of Object.entries(item)) {
        if (!STRUCTURAL.has(key) && (typeof value === 'string' || typeof value === 'number')) {
          push(key, String(value));
        }
      }
    }
  }
  return out;
}

/**
 * The READ-ONLY slice of the Ecowitt facade the {@link Dumper} consumes. Declared as an interface so
 * a test can inject a real-emitter-backed fake with NO cast; a real `Ecowitt` instance structurally
 * satisfies it. It exposes only OBSERVATION surface — `on`/`off`/`getSensors`/`getStationInfo` —
 * NEVER `start`/`stop` of the client, so the dumper cannot tear down the user's client or command
 * anything.
 */
export interface DumperClient {
  on<K extends keyof EcowittEvents>(event: K, listener: (payload: EcowittEvents[K]) => void): this;
  off<K extends keyof EcowittEvents>(event: K, listener: (payload: EcowittEvents[K]) => void): this;
  getSensors(): StationSnapshot['sensors'];
  getStationInfo(): StationInfo;
}

/** Tunables for a {@link Dumper}. All optional. */
export interface DumperOptions {
  /** Capture raw transport frames into `observations.rawFrames` + scan their keys for unmapped. */
  captureRawFrames?: boolean;
  /** Cap on retained raw frames (ring). Default 500. */
  maxRawFrames?: number;
}

/**
 * A passive, READ-ONLY observer of an Ecowitt client. {@link start} attaches to the live `update`
 * stream (and, when `captureRawFrames` is on, the `rawFrame` stream); {@link stop} detaches exactly
 * the dumper's own listeners (idempotent; it NEVER calls `client.stop()`). {@link export} assembles
 * the ANONYMIZED, zod-valid {@link DeviceDump} — raw frames are redacted so any mac/passkey/ssid the
 * gateway sent is scrubbed. The dumper NEVER commands the gateway (nodewitt has no commands).
 */
export class Dumper {
  readonly #client: DumperClient;
  readonly #opts: { captureRawFrames: boolean; maxRawFrames: number };
  readonly #acc = new SensorAccumulator();
  readonly #rawFrames: RawFrame[] = [];
  readonly #onUpdate: (sensors: ReadonlyArray<Sensor>) => void;
  readonly #onRawFrame: (frame: EcowittEvents['rawFrame']) => void;
  #startedAt = 0;
  #started = false;

  constructor(client: DumperClient, options: DumperOptions = {}) {
    this.#client = client;
    this.#opts = {
      captureRawFrames: options.captureRawFrames ?? false,
      maxRawFrames: options.maxRawFrames ?? DEFAULT_MAX_RAW_FRAMES,
    };
    // Bound once so off() removes the EXACT reference on() registered.
    this.#onUpdate = (sensors): void => {
      const now = Date.now();
      for (const s of sensors) this.#acc.recordSensor(s, now);
    };
    this.#onRawFrame = (frame): void => {
      this.#captureFrame(frame.source, frame.payload);
    };
  }

  /** Attach to the live stream(s). Idempotent. Read-only (never starts/stops the client). */
  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#startedAt = Date.now();
    this.#client.on('update', this.#onUpdate);
    if (this.#opts.captureRawFrames) {
      this.#client.on('rawFrame', this.#onRawFrame);
    }
  }

  /** Detach the dumper's own listeners. Idempotent. Leaves the client otherwise intact. */
  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#client.off('update', this.#onUpdate);
    if (this.#opts.captureRawFrames) {
      this.#client.off('rawFrame', this.#onRawFrame);
    }
  }

  /**
   * Feed a raw transport frame directly (the auto-subscribed `rawFrame` path uses the same logic):
   * scans each flat key for unmapped measurement keys / undecodable batteries and appends the
   * ANONYMIZED frame to the timeline (capped). A no-op when `captureRawFrames` is off.
   */
  recordFrame(source: RawFrameSource, payload: unknown): void {
    if (!this.#opts.captureRawFrames) {
      return;
    }
    this.#captureFrame(source, payload);
  }

  #captureFrame(source: RawFrameSource, payload: unknown): void {
    const now = Date.now();
    for (const { key, value } of extractFrameKeys(source, payload)) {
      this.#acc.recordRawKey(key, value, now);
    }
    this.#rawFrames.push({ at: now, source, payload: redact(payload) });
    if (this.#rawFrames.length > this.#opts.maxRawFrames) {
      this.#rawFrames.shift();
    }
  }

  /** Build the anonymized, schema-valid dump. Works live or after {@link stop}. */
  export(): DeviceDump {
    const now = Date.now();
    const info = this.#client.getStationInfo();
    const dump: DeviceDump = {
      schemaVersion: 1,
      library: 'nodewitt',
      libraryVersion: LIBRARY_VERSION,
      device: {
        model: info.model ?? 'ecowitt',
        ...(info.firmware !== undefined ? { firmware: info.firmware } : {}),
        type: 'weather-station',
      },
      observations: {
        properties: this.#acc.snapshot(),
        events: [],
        ...(this.#opts.captureRawFrames ? { rawFrames: [...this.#rawFrames] } : {}),
      },
      catalog: buildCatalog(this.#client.getSensors()),
      meta: {
        startedAt: this.#startedAt,
        durationMs: Math.max(0, now - this.#startedAt),
        generatedAt: now,
      },
    };
    // redact(dump) returns `unknown`; DeviceDumpSchema.parse re-types it back to DeviceDump with ZERO
    // cast (parse's return type IS DeviceDump).
    const anonymized = redact(dump);
    return DeviceDumpSchema.parse(anonymized);
  }

  /** Deterministic pretty JSON of {@link export}. */
  exportJson(): string {
    return JSON.stringify(this.export(), null, 2);
  }
}

/**
 * Create a read-only {@link Dumper} for an Ecowitt client. The dumper only observes the client's
 * event stream + sensor snapshot — it issues no command and never tears down the client.
 */
export function createDumper(client: DumperClient, options?: DumperOptions): Dumper {
  return new Dumper(client, options ?? {});
}
