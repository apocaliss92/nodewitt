/**
 * A tiny, cast-free typed event emitter over `node:events`.
 *
 * `EventMap` maps each event name to its single payload type. The outer class supplies ALL of the
 * typing: `on`/`once`/`off` take a `Listener<E[K]>` and `emit` takes the matching payload. They
 * delegate to a plain `EventEmitter`, whose declared parameter types (`listener: (...args) => void`
 * for registration, `...args` for `emit`) accept our more-specific typed values by ordinary
 * function-assignability — so there is NO `as`, no `any`, no `unknown as` anywhere in this module.
 * Each public event carries a single payload, marshalled as the emitter's single positional arg.
 */

import { EventEmitter } from 'node:events';

/** Public event map: each event name maps to its single payload type. */
export type EventMap = Record<PropertyKey, unknown>;

/** A listener for a single-payload event. */
export type Listener<P> = (payload: P) => void;

export class TypedEmitter<E> {
  private readonly emitter = new EventEmitter();

  on<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    this.emitter.on(event, listener);
    return this;
  }

  once<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    this.emitter.once(event, listener);
    return this;
  }

  off<K extends keyof E & string>(event: K, listener: Listener<E[K]>): this {
    this.emitter.off(event, listener);
    return this;
  }

  emit<K extends keyof E & string>(event: K, payload: E[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  /** Number of registered listeners for an event (internal diagnostics use). */
  listenerCount<K extends keyof E & string>(event: K): number {
    return this.emitter.listenerCount(event);
  }

  removeAllListeners(): this {
    this.emitter.removeAllListeners();
    return this;
  }
}
