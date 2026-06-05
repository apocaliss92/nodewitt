/**
 * HTTP push listener for Ecowitt "Customized" uploads.
 *
 * A minimal `node:http` server that accepts a POST on ANY path, reads the
 * `application/x-www-form-urlencoded` body, parses it into a flat key/value map via
 * `URLSearchParams`, and hands the map to the `onForm` callback. It always responds `OK`.
 *
 * Resilient by construction: the body is size-capped, a malformed/oversized body is answered
 * (still `OK`, so the gateway does not retry-storm) without throwing, and a throwing `onForm`
 * callback is isolated so one bad payload never crashes the server. No I/O beyond the socket.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decodePushForm, type PushDecodeResult } from './ecowitt-form.js';

/** Default Ecowitt "Customized" listen port (documented protocol default). */
export const DEFAULT_PUSH_PORT = 4199;

/** 1 MiB body cap — far above any real Ecowitt upload; guards against abuse. */
const MAX_BODY_BYTES = 1_048_576;

export interface PushListenerOptions {
  /** TCP port to listen on. Defaults to 4199; pass 0 for an ephemeral port (tests). */
  readonly port?: number;
  /** Optional bind host (default: all interfaces). */
  readonly host?: string;
  /** Raw flat-map callback (optional). At least one of onForm/onReadings is required. */
  readonly onForm?: (form: Record<string, string>) => void;
  /** Decoded-readings callback (optional). At least one of onForm/onReadings is required. */
  readonly onReadings?: (result: PushDecodeResult) => void;
  /** Optional error sink (parse/callback failures); never throws back into the server. */
  readonly onError?: (error: unknown) => void;
}

/** Parse an x-www-form-urlencoded body into a flat key/value map (last value wins per key). */
export function parseFormBody(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const out: Record<string, string> = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

export class PushListener {
  private readonly options: PushListenerOptions;
  private server: Server | undefined;

  constructor(options: PushListenerOptions) {
    if (options.onForm === undefined && options.onReadings === undefined) {
      throw new Error('PushListener: provide onForm and/or onReadings');
    }
    this.options = options;
  }

  /** Start listening; resolves with the bound address (incl. the chosen port for `port: 0`). */
  start(): Promise<AddressInfo> {
    if (this.server !== undefined) {
      return Promise.reject(new Error('PushListener already started'));
    }
    const server = createServer((req, res) => {
      this.handle(req, res);
    });
    this.server = server;
    const port = this.options.port ?? DEFAULT_PUSH_PORT;
    return new Promise<AddressInfo>((resolve, reject) => {
      server.once('error', reject);
      const onListening = (): void => {
        server.removeListener('error', reject);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('PushListener: unexpected server address'));
          return;
        }
        resolve(address);
      };
      if (this.options.host !== undefined) {
        server.listen(port, this.options.host, onListening);
      } else {
        server.listen(port, onListening);
      }
    });
  }

  /** Stop the server; resolves once closed. Safe to call when not started. */
  stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return Promise.resolve();
    this.server = undefined;
    return new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      res.statusCode = 200;
      res.end('OK');
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        aborted = true;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (error) => {
      this.report(error);
    });
    req.on('end', () => {
      if (aborted) {
        this.respondOk(res);
        return;
      }
      this.dispatch(Buffer.concat(chunks).toString('utf8'), res);
    });
  }

  private dispatch(body: string, res: ServerResponse): void {
    try {
      const form = parseFormBody(body);
      if (this.options.onForm !== undefined) this.options.onForm(form);
      if (this.options.onReadings !== undefined) this.options.onReadings(decodePushForm(form));
    } catch (error) {
      this.report(error);
    } finally {
      this.respondOk(res);
    }
  }

  private respondOk(res: ServerResponse): void {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('OK');
  }

  private report(error: unknown): void {
    if (this.options.onError !== undefined) this.options.onError(error);
  }
}
