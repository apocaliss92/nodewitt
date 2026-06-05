/**
 * The public `Ecowitt` facade: wire either transport into one Station + a typed event stream.
 *
 * `createLocal` composes HttpClient → Endpoints → LocalPoller and reuses the poller's OWN primed
 * `SensorMapper` (via `LocalPoller.getMapper()`) as the model's lookup, so the facade and the
 * `Station` share a single mapper with no duplicate fetch and no model/channel/signal drift. Every
 * poll batch is routed into the `Station` and re-emitted as `update`/`sensorChanged`/`snapshot`,
 * and any transport error becomes an `error` event (never a throw). Both transports expose a
 * uniform `start`/`stop`/`on`/`off`/`getStation`. The transport build sits behind an internal seam
 * (`__createLocalWith`/`__createListenerWith`) so tests inject fakes without a real socket — the
 * seams are NOT re-exported from `index.ts`, so they stay off the published surface.
 */

import type { AddressInfo } from 'node:net';
import { HttpClient } from '../local/http-client.js';
import { Endpoints } from '../local/endpoints.js';
import { LocalPoller, type ResolvedReading } from '../local/poller.js';
import { PushListener } from '../push/listener.js';
import type { PushDecodeResult } from '../push/ecowitt-form.js';
import { Station, type StationSnapshot, type SensorInfoLookup } from '../model/station.js';
import { TypedEmitter, type Listener } from './events.js';
import type { EcowittEvents, LocalOptions, ListenerOptions } from './types.js';

/** The minimal transport handle the facade drives (poll or push). */
interface TransportHandle {
  start(): Promise<void>;
  stop(): void | Promise<void>;
}

/** A built local transport: the poller handle + the lookup the Station needs. */
export interface LocalTransport extends TransportHandle {
  readonly lookup: SensorInfoLookup;
}

/** A built listener transport: exposes the bound address (for `port: 0`). */
export interface ListenerTransport extends TransportHandle {
  getAddress(): AddressInfo | undefined;
}

/** Callbacks the facade supplies to a local transport builder. */
interface LocalBuildOptions {
  readonly onReadings: (readings: ResolvedReading[]) => void;
  readonly onError: (error: unknown) => void;
}

/** Callbacks the facade supplies to a listener transport builder. */
interface ListenerBuildOptions {
  readonly onReadings: (result: PushDecodeResult) => void;
  readonly onError: (error: unknown) => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** The facade instance returned by the factories. */
export class Ecowitt {
  private readonly station = new Station();
  private readonly emitter = new TypedEmitter<EcowittEvents>();
  private readonly transport: TransportHandle;
  private addressSource: (() => AddressInfo | undefined) | undefined;

  /** @internal — constructed via the static factories / internal seams. */
  protected constructor(buildTransport: (self: Ecowitt) => TransportHandle) {
    this.transport = buildTransport(this);
  }

  static createLocal(options: LocalOptions): Ecowitt {
    return __createLocalWith(options, defaultLocalBuilder(options));
  }

  static createListener(options: ListenerOptions = {}): Ecowitt {
    return __createListenerWith(options);
  }

  on<K extends keyof EcowittEvents>(event: K, listener: Listener<EcowittEvents[K]>): this {
    this.emitter.on(event, listener);
    return this;
  }

  off<K extends keyof EcowittEvents>(event: K, listener: Listener<EcowittEvents[K]>): this {
    this.emitter.off(event, listener);
    return this;
  }

  async start(): Promise<void> {
    await this.transport.start();
  }

  async stop(): Promise<void> {
    await this.transport.stop();
    this.emitter.removeAllListeners();
  }

  getStation(): StationSnapshot {
    return this.station.getStation();
  }

  /** Convenience accessor: all sensors. */
  getSensors(): StationSnapshot['sensors'] {
    return this.station.getStation().sensors;
  }

  /** Bound listen address (listener transport only); undefined before start or for local. */
  getAddress(): AddressInfo | undefined {
    return this.addressSource?.();
  }

  /** @internal — ingest a poll batch + emit. Used by the local transport wiring. */
  acceptPoll(readings: ResolvedReading[], lookup: SensorInfoLookup): void {
    const changed = this.station.ingestPollReadings(readings, lookup, Date.now());
    this.publish(changed);
  }

  /** @internal — ingest a decoded push body + emit. Used by the listener transport wiring. */
  acceptPush(result: PushDecodeResult): void {
    const changed = this.station.ingestPushResult(result, Date.now());
    this.publish(changed);
  }

  /** @internal — register the listener transport's bound-address source. */
  bindAddressSource(source: () => AddressInfo | undefined): void {
    this.addressSource = source;
  }

  /** @internal — surface a transport error as an `error` event (never throws). */
  acceptError(error: unknown): void {
    this.emitter.emit('error', toError(error));
  }

  private publish(changed: ReadonlyArray<StationSnapshot['sensors'][number]>): void {
    if (changed.length > 0) {
      this.emitter.emit('update', changed);
      for (const sensor of changed) this.emitter.emit('sensorChanged', sensor);
    }
    this.emitter.emit('snapshot', this.station.getStation());
  }
}

/** Internal seam: build a local-transport Ecowitt, injecting the transport builder (tests use this). */
export function __createLocalWith(
  options: LocalOptions,
  build: (opts: LocalBuildOptions) => LocalTransport,
): Ecowitt {
  let lookupRef: SensorInfoLookup = { getSensorInfo: () => undefined };
  return new EcowittFactory((self) => {
    const transport = build({
      onReadings: (readings) => self.acceptPoll(readings, lookupRef),
      onError: (error) => self.acceptError(error),
    });
    lookupRef = transport.lookup;
    return transport;
  });
}

/** The real local transport: HttpClient → Endpoints → LocalPoller, sharing the poller's mapper. */
function defaultLocalBuilder(options: LocalOptions): (opts: LocalBuildOptions) => LocalTransport {
  return ({ onReadings, onError }) => {
    const http = new HttpClient({
      host: options.host,
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.password !== undefined ? { password: options.password } : {}),
    });
    const endpoints = new Endpoints(http);
    const poller = new LocalPoller({
      endpoints,
      ...(options.pollIntervalMs !== undefined ? { scanIntervalMs: options.pollIntervalMs } : {}),
      ...(options.mappingIntervalMs !== undefined
        ? { mappingIntervalMs: options.mappingIntervalMs }
        : {}),
      onReadings,
      onError,
    });
    return {
      start: () => poller.start(),
      stop: () => poller.stop(),
      // Share the poller's OWN primed mapper — single source of truth, kept fresh by the poller.
      lookup: poller.getMapper(),
    };
  };
}

/** Internal seam: build a listener-transport Ecowitt (tests can inject a fake builder). */
export function __createListenerWith(
  options: ListenerOptions,
  build: (opts: ListenerBuildOptions) => ListenerTransport = defaultListenerBuilder(options),
): Ecowitt {
  let transportRef: ListenerTransport | undefined;
  return new EcowittFactory((self) => {
    const transport = build({
      onReadings: (result) => self.acceptPush(result),
      onError: (error) => self.acceptError(error),
    });
    transportRef = transport;
    self.bindAddressSource(() => transportRef?.getAddress());
    return transport;
  });
}

/** The real listener transport: a `PushListener` whose decoded results feed the same Station. */
function defaultListenerBuilder(
  options: ListenerOptions,
): (opts: ListenerBuildOptions) => ListenerTransport {
  return ({ onReadings, onError }) => {
    let address: AddressInfo | undefined;
    const listener = new PushListener({
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
      onReadings,
      onError,
    });
    return {
      start: async () => {
        address = await listener.start();
      },
      stop: () => listener.stop(),
      getAddress: () => address,
    };
  };
}

/**
 * Same-module subclass that exposes the protected `Ecowitt` constructor to the seam functions
 * without any cast. The class itself is not exported; the seams return a plain `Ecowitt`.
 */
class EcowittFactory extends Ecowitt {
  constructor(buildTransport: (self: Ecowitt) => TransportHandle) {
    super(buildTransport);
  }
}
