/**
 * Public option and event types for the Ecowitt facade.
 *
 * These are the ONLY transport-shaped types crossing the public boundary; everything else
 * (poller/listener/decoder internals) stays private. `EcowittEvents` is the event-map the typed
 * emitter is parameterized by, so `on('update', …)`/`on('sensorChanged', …)` are fully typed.
 */

import type { Sensor } from '../model/sensor.js';
import type { StationSnapshot } from '../model/station.js';

/** Options for the local-poll transport. */
export interface LocalOptions {
  /** Gateway host or IP (e.g. "192.168.20.181"). */
  readonly host: string;
  /** Gateway HTTP port (default 80). */
  readonly port?: number;
  /** Optional gateway password (newer firmware). */
  readonly password?: string;
  /** Live-data poll interval in ms (default 60000). */
  readonly pollIntervalMs?: number;
  /** Sensor-map refresh interval in ms (default 600000). */
  readonly mappingIntervalMs?: number;
}

/** Options for the push-listener transport. */
export interface ListenerOptions {
  /** TCP port to listen on (default 4199; 0 = ephemeral). */
  readonly port?: number;
  /** Optional bind host. */
  readonly host?: string;
}

/** Either transport's option shape (documentation / discriminated factory use). */
export type EcowittOptions =
  | ({ readonly transport: 'local' } & LocalOptions)
  | ({ readonly transport: 'listener' } & ListenerOptions);

/** Origin of a {@link RawFrame}: a local poll tick or a pushed "Customized" upload. */
export type RawFrameSource = 'poll' | 'push';

/**
 * A RAW, undecoded transport frame surfaced for diagnostics. `payload` is the raw
 * `/get_livedata_info` object for a `poll` and the raw flat form map for a `push`
 * — exactly what the gateway sent, BEFORE decode/classification. Consumed by the
 * diagnostic dumper to surface measurement keys the Station would otherwise drop
 * (its anonymizer redacts any secret the raw payload carries). Typed `unknown`
 * because the two sources differ in shape; consumers narrow as needed.
 */
export interface RawFrame {
  /** Where the frame came from. */
  readonly source: RawFrameSource;
  /** The raw, undecoded frame payload (shape depends on `source`). */
  readonly payload: unknown;
}

/** Lightweight gateway identity (from `/get_version`). Both fields are best-effort. */
export interface StationInfo {
  /** Gateway model / station type (e.g. "GW2000A_V3.1.5"); omitted when unknown. */
  readonly model?: string;
  /** Gateway firmware version string; omitted when unknown. */
  readonly firmware?: string;
}

/** Event-map for the facade's typed emitter (single payload per event). */
export type EcowittEvents = {
  /** A batch of sensors updated by the latest ingest (poll tick or push body). */
  readonly update: ReadonlyArray<Sensor>;
  /** A single sensor whose value/battery changed. */
  readonly sensorChanged: Sensor;
  /** The full snapshot after an ingest (convenience for UI consumers). */
  readonly snapshot: StationSnapshot;
  /** A transport/decoder error (never throws into the consumer). */
  readonly error: Error;
  /** A raw, undecoded transport frame (for diagnostics; see {@link RawFrame}). */
  readonly rawFrame: RawFrame;
};
