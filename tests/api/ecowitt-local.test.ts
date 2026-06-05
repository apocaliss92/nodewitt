import { describe, it, expect, vi } from 'vitest';
import { __createLocalWith, type LocalTransport } from '../../src/api/ecowitt.js';
import type { ResolvedReading } from '../../src/local/poller.js';
import type { MappedSensor } from '../../src/local/sensor-mapper.js';

// A fake poller that captures the facade callbacks and lets the test drive onReadings/onError.
function fakePollerFactory(): {
  build: (opts: {
    onReadings: (r: ResolvedReading[]) => void;
    onError: (e: unknown) => void;
  }) => LocalTransport;
  fireReadings: (r: ResolvedReading[]) => void;
  fireError: (e: unknown) => void;
  built: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } | undefined;
} {
  let onReadings: ((r: ResolvedReading[]) => void) | undefined;
  let onError: ((e: unknown) => void) | undefined;
  const info: Record<string, MappedSensor> = {
    HID: { hardwareId: 'HID', model: 'wh31', channel: 1, battery: '0', signal: '4' },
  };
  const state: {
    built: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } | undefined;
  } = { built: undefined };
  return {
    build: (opts) => {
      onReadings = opts.onReadings;
      onError = opts.onError;
      const handle = {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        lookup: { getSensorInfo: (id: string): MappedSensor | undefined => info[id] },
      };
      state.built = handle;
      return handle;
    },
    fireReadings: (r) => onReadings?.(r),
    fireError: (e) => onError?.(e),
    get built() {
      return state.built;
    },
  };
}

describe('Ecowitt.createLocal (wired via the internal seam)', () => {
  it('routes poller readings into the Station and emits update + sensorChanged + snapshot', async () => {
    const fake = fakePollerFactory();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    const updates: number[] = [];
    const changes: string[] = [];
    let snapshots = 0;
    client.on('update', (sensors) => updates.push(sensors.length));
    client.on('sensorChanged', (s) => changes.push(s.id));
    client.on('snapshot', () => (snapshots += 1));

    await client.start();
    fake.fireReadings([
      { key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'HID' },
      { key: 'humidity1', value: 45, unit: '%', raw: '45', hardwareId: 'HID' },
    ]);

    expect(updates.at(-1)).toBeGreaterThanOrEqual(2);
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(snapshots).toBeGreaterThanOrEqual(1);
    expect(client.getStation().sensors.find((s) => s.model === 'wh31')).toBeDefined();
    await client.stop();
  });

  it('forwards poller errors to the error event (wrapped as Error)', async () => {
    const fake = fakePollerFactory();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    const errors: string[] = [];
    client.on('error', (e) => errors.push(e.message));
    await client.start();
    fake.fireError(new Error('poll failed'));
    expect(errors).toContain('poll failed');
    await client.stop();
  });

  it('wraps a non-Error thrown value into an Error for the error event', async () => {
    const fake = fakePollerFactory();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    const errors: string[] = [];
    client.on('error', (e) => errors.push(e.message));
    await client.start();
    fake.fireError('string failure');
    expect(errors).toContain('string failure');
    await client.stop();
  });

  it('start/stop delegate to the poller (no leaked handles)', async () => {
    const fake = fakePollerFactory();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    await client.start();
    await client.stop();
    expect(fake.built?.start).toHaveBeenCalledTimes(1);
    expect(fake.built?.stop).toHaveBeenCalledTimes(1);
  });

  it('off() removes a previously registered update listener', async () => {
    const fake = fakePollerFactory();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    const updates: number[] = [];
    const listener = (sensors: ReadonlyArray<{ id: string }>): void => {
      updates.push(sensors.length);
    };
    client.on('update', listener);
    client.off('update', listener);
    await client.start();
    fake.fireReadings([{ key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'HID' }]);
    expect(updates).toHaveLength(0);
    await client.stop();
  });

  it('getSensors() returns the same sensors as getStation().sensors', async () => {
    const fake = fakePollerFactory();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    await client.start();
    fake.fireReadings([{ key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'HID' }]);
    expect(client.getSensors()).toEqual(client.getStation().sensors);
    await client.stop();
  });
});
