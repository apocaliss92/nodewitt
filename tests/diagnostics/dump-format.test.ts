import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DeviceDumpSchema, type DeviceDump } from '../../src/diagnostics/dump-format.js';
import { LIBRARY_VERSION } from '../../src/support/version.js';

function goodDump(): DeviceDump {
  return {
    schemaVersion: 1,
    library: 'nodewitt',
    libraryVersion: '1.1.0',
    device: { model: 'ecowitt', type: 'weather-station' },
    observations: {
      properties: {
        'sensor:temperature': {
          values: [6.3, 7.1],
          unmapped: [],
          enum: 'temperature',
          count: 2,
          firstSeen: 1000,
          lastSeen: 2000,
        },
        'model:wh99': {
          values: ['wh99'],
          unmapped: ['wh99'],
          count: 1,
          firstSeen: 1500,
          lastSeen: 1500,
        },
      },
      events: [],
    },
    catalog: {
      sensors: [{ model: 'wh31', channel: 1 }, { model: 'ws90' }],
      capabilities: { models: ['wh31', 'ws90'], measurementKeys: ['0x02', 'temp1f'] },
    },
    meta: { startedAt: 1000, durationMs: 1000, generatedAt: 2100 },
  };
}

describe('DeviceDumpSchema', () => {
  it('validates a well-formed nodewitt dump', () => {
    expect(DeviceDumpSchema.safeParse(goodDump()).success).toBe(true);
  });
  it('accepts optional rawFrames', () => {
    const d = goodDump();
    const withRaw: DeviceDump = {
      ...d,
      observations: {
        ...d.observations,
        rawFrames: [{ at: 1, source: 'push', payload: { tempf: '50.0' } }],
      },
    };
    expect(DeviceDumpSchema.safeParse(withRaw).success).toBe(true);
  });
  it('rejects a wrong schemaVersion', () => {
    expect(DeviceDumpSchema.safeParse({ ...goodDump(), schemaVersion: 2 }).success).toBe(false);
  });
  it('rejects a non-enum library value', () => {
    expect(DeviceDumpSchema.safeParse({ ...goodDump(), library: 'nodefoo' }).success).toBe(false);
  });
  it('accepts library nodewitt (the shared union member)', () => {
    expect(goodDump().library).toBe('nodewitt');
  });
});

describe('LIBRARY_VERSION', () => {
  it('matches package.json version (so the hardcoded constant cannot drift)', () => {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
      throw new Error('package.json has no version field');
    }
    const version = parsed.version;
    if (typeof version !== 'string') {
      throw new Error('package.json version is not a string');
    }
    expect(LIBRARY_VERSION).toBe(version);
  });
});
