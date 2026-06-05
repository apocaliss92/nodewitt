/**
 * Public-API surface + leak test.
 *
 * Asserts the published package root (`src/index.ts`) exports EXACTLY the intended public surface
 * and leaks NO transport/protocol/model internals or test seams. Value exports are checked at
 * RUNTIME against the imported module; type-only exports (which are not runtime keys) and negative
 * leak checks are read from the `src/index.ts` SOURCE — NOT from `dist/index.d.ts`. The gate runs
 * `test:cov` BEFORE `build`, so `dist/` does not exist in CI; reading it would ENOENT-fail. Reading
 * the source instead keeps this test dist-independent.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as api from '../../src/index.js';

const INDEX_SOURCE = readFileSync(
  fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
  'utf8',
);

/** Value exports that MUST exist as runtime keys on the package root. */
const VALUE_EXPORTS = ['Ecowitt', 'LIBRARY_NAME'] as const;

/** Type-only exports that MUST appear in an `export type { … }` in the source (no runtime key). */
const TYPE_EXPORTS = [
  'Sensor',
  'BatteryUnit',
  'StationSnapshot',
  'Quantity',
  'LocalOptions',
  'ListenerOptions',
  'EcowittOptions',
  'EcowittEvents',
] as const;

/**
 * Internals that MUST NOT leak from the package root — neither as a source `export` statement nor
 * as a runtime key. Covers poller/listener/decoders/mapper/protocol/Station/TypedEmitter and the
 * `__create*With` seams + the `accept*` facade-internal methods.
 */
const FORBIDDEN = [
  'LocalPoller',
  'PushListener',
  'Endpoints',
  'HttpClient',
  'SensorMapper',
  'Station',
  'decodePushForm',
  'decodeLiveData',
  'parseValue',
  'lookupHexId',
  'TypedEmitter',
  'EventMap',
  'Listener',
  'EcowittFactory',
  'LocalTransport',
  'ListenerTransport',
  '__createLocalWith',
  '__createListenerWith',
  'acceptPoll',
  'acceptPush',
  'acceptError',
] as const;

describe('public API surface', () => {
  it('exposes exactly the intended runtime (value) exports', () => {
    expect(Object.keys(api).sort()).toEqual([...VALUE_EXPORTS].sort());
  });

  it('exposes the static factories on Ecowitt', () => {
    expect(typeof api.Ecowitt.createLocal).toBe('function');
    expect(typeof api.Ecowitt.createListener).toBe('function');
  });

  it('declares every public type via an `export type { … }` in the source', () => {
    const typeBlocks = [...INDEX_SOURCE.matchAll(/export\s+type\s*\{([^}]*)\}/g)]
      .map((m) => m[1] ?? '')
      .join(',');
    const exportedTypeNames = new Set(
      typeBlocks
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    );
    for (const name of TYPE_EXPORTS) {
      expect(exportedTypeNames.has(name)).toBe(true);
    }
  });

  it('does NOT leak any internal as a runtime key', () => {
    for (const name of FORBIDDEN) {
      expect(Object.prototype.hasOwnProperty.call(api, name)).toBe(false);
    }
  });

  it('does NOT export any internal from the source index', () => {
    for (const name of FORBIDDEN) {
      // Match an export statement that names the internal (e.g. `export { Station }`,
      // `export type { Station }`, `export { Station as X }`) — word-boundary guarded.
      const exportNamePattern = new RegExp(String.raw`export[^;]*\{[^}]*\b${name}\b[^}]*\}`, 's');
      expect(INDEX_SOURCE).not.toMatch(exportNamePattern);
    }
  });
});
