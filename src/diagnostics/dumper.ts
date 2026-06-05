import type { Sensor } from '../model/sensor.js';
import { liveDataKeysForModel } from '../protocol/sensor-models.js';
import { classifyKey } from '../model/quantity.js';
import {
  decodeBarBattery,
  decodeBinaryBattery,
  decodeVoltageBattery,
} from '../protocol/battery.js';
import type { DeviceDump } from './dump-format.js';

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
