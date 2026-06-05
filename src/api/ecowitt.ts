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
 *
 * The instance ingest seams (`#acceptPoll`/`#acceptPush`/`#acceptError`) and the address-source are
 * native-`#`-private: the wiring that connects a transport builder's callbacks to them runs inside
 * the class (`#buildLocal`/`#buildListener`), so none of those methods appear on an instance or in
 * `dist/index.d.ts`. A static initializer publishes those builders into a module-local `seam` so the
 * exported test seams can inject fake transports cast-free, without widening the public surface.
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

/**
 * Module-private wiring seam, populated by the class's static initializer block (which runs in class
 * scope and can therefore reach the `#`-private builders). The module-level test seams call through
 * here cast-free. It is a module local — NOT a class member — so it never appears on the `Ecowitt`
 * type surface (no `accept*` method, no internal build-option types bleed into `dist/index.d.ts`).
 */
let seam: {
  buildLocal: (build: (opts: LocalBuildOptions) => LocalTransport) => Ecowitt;
  buildListener: (build: (opts: ListenerBuildOptions) => ListenerTransport) => Ecowitt;
};

/** The facade instance returned by the factories. */
export class Ecowitt {
  readonly #station = new Station();
  readonly #emitter = new TypedEmitter<EcowittEvents>();
  readonly #transport: TransportHandle;
  #addressSource: (() => AddressInfo | undefined) | undefined;

  /**
   * Private constructor: instances are created only via the static factories / internal seams.
   * `wire` runs INSIDE the class body, so it can reach the `#`-private ingest/error seams through
   * the captured `this` — the wiring never escapes the class, and the seams stay off the surface.
   */
  private constructor(wire: (self: Ecowitt) => TransportHandle) {
    this.#transport = wire(this);
  }

  static createLocal(options: LocalOptions): Ecowitt {
    return Ecowitt.#buildLocal(defaultLocalBuilder(options));
  }

  static createListener(options: ListenerOptions = {}): Ecowitt {
    return Ecowitt.#buildListener(defaultListenerBuilder(options));
  }

  /**
   * Build a local-transport facade from a transport builder. The wiring closure that hands the
   * builder its `onReadings`/`onError` callbacks lives HERE, inside the class, so it can call the
   * `#`-private ingest seams directly — no public method, no cast. `#`-private so it is unreachable
   * from outside the class; the exported test seam `__createLocalWith` re-exports it (bound) below.
   */
  static #buildLocal(build: (opts: LocalBuildOptions) => LocalTransport): Ecowitt {
    let lookup: SensorInfoLookup = {
      getSensorInfo: () => undefined,
      getSensorInfoForKey: () => undefined,
    };
    return new Ecowitt((self) => {
      const transport = build({
        onReadings: (readings) => self.#acceptPoll(readings, lookup),
        onError: (error) => self.#acceptError(error),
      });
      lookup = transport.lookup;
      return transport;
    });
  }

  /** Build a listener-transport facade from a transport builder (wiring stays inside the class). */
  static #buildListener(build: (opts: ListenerBuildOptions) => ListenerTransport): Ecowitt {
    return new Ecowitt((self) => {
      const transport = build({
        onReadings: (result) => self.#acceptPush(result),
        onError: (error) => self.#acceptError(error),
      });
      self.#addressSource = (): AddressInfo | undefined => transport.getAddress();
      return transport;
    });
  }

  /**
   * Publish the `#`-private builders into the module-local `seam` so the file's test seams can
   * inject a fake transport builder cast-free. Runs in class scope (so `#buildLocal`/`#buildListener`
   * are reachable); writes only to a module local, so nothing is added to the type/runtime surface.
   */
  static {
    seam = {
      buildLocal: (build) => Ecowitt.#buildLocal(build),
      buildListener: (build) => Ecowitt.#buildListener(build),
    };
  }

  on<K extends keyof EcowittEvents>(event: K, listener: Listener<EcowittEvents[K]>): this {
    this.#emitter.on(event, listener);
    return this;
  }

  once<K extends keyof EcowittEvents>(event: K, listener: Listener<EcowittEvents[K]>): this {
    this.#emitter.once(event, listener);
    return this;
  }

  off<K extends keyof EcowittEvents>(event: K, listener: Listener<EcowittEvents[K]>): this {
    this.#emitter.off(event, listener);
    return this;
  }

  async start(): Promise<void> {
    await this.#transport.start();
  }

  /**
   * Stop the transport and remove all listeners. TERMINAL: the transport cannot be restarted —
   * create a new `Ecowitt` via `createLocal`/`createListener` to resume. All listeners are removed.
   */
  async stop(): Promise<void> {
    await this.#transport.stop();
    this.#emitter.removeAllListeners();
  }

  getStation(): StationSnapshot {
    return this.#station.getStation();
  }

  /** Convenience accessor: all sensors. */
  getSensors(): StationSnapshot['sensors'] {
    return this.#station.getStation().sensors;
  }

  /** Bound listen address (listener transport only); undefined before start or for local. */
  getAddress(): AddressInfo | undefined {
    return this.#addressSource?.();
  }

  /** Ingest a poll batch + emit. */
  #acceptPoll(readings: ResolvedReading[], lookup: SensorInfoLookup): void {
    const changed = this.#station.ingestPollReadings(readings, lookup, Date.now());
    this.#publish(changed);
  }

  /** Ingest a decoded push body + emit. */
  #acceptPush(result: PushDecodeResult): void {
    const changed = this.#station.ingestPushResult(result, Date.now());
    this.#publish(changed);
  }

  /** Surface a transport error as an `error` event (never throws). */
  #acceptError(error: unknown): void {
    this.#emitter.emit('error', toError(error));
  }

  #publish(changed: ReadonlyArray<StationSnapshot['sensors'][number]>): void {
    if (changed.length > 0) {
      this.#emitter.emit('update', changed);
      for (const sensor of changed) this.#emitter.emit('sensorChanged', sensor);
    }
    this.#emitter.emit('snapshot', this.#station.getStation());
  }
}

/** Internal seam: build a local-transport Ecowitt, injecting the transport builder (tests use this). */
export function __createLocalWith(
  _options: LocalOptions,
  build: (opts: LocalBuildOptions) => LocalTransport,
): Ecowitt {
  return seam.buildLocal(build);
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
  return seam.buildListener(build);
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
