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
};
