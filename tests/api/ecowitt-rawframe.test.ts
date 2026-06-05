import { describe, it, expect, vi } from 'vitest';
import { __createLocalWith, type LocalTransport } from '../../src/api/ecowitt.js';
import type { ResolvedReading } from '../../src/local/poller.js';
import type { RawLiveData } from '../../src/local/livedata.js';
import type { RawFrame, StationInfo } from '../../src/api/types.js';
import type { MappedSensor } from '../../src/local/sensor-mapper.js';

/** A fake local transport that lets the test drive readings + raw frames + station info. */
function fakeLocal(): {
  build: (opts: {
    onReadings: (r: ResolvedReading[]) => void;
    onError: (e: unknown) => void;
    onRawFrame?: (raw: RawLiveData) => void;
  }) => LocalTransport;
  fireRawFrame: (raw: RawLiveData) => void;
  setInfo: (info: StationInfo) => void;
} {
  let onRawFrame: ((raw: RawLiveData) => void) | undefined;
  let info: StationInfo = {};
  const lookup: MappedSensor | undefined = undefined;
  return {
    build: (opts) => {
      onRawFrame = opts.onRawFrame;
      return {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        lookup: {
          getSensorInfo: (): MappedSensor | undefined => lookup,
          getSensorInfoForKey: (): MappedSensor | undefined => lookup,
        },
        getStationInfo: () => info,
      };
    },
    fireRawFrame: (raw) => onRawFrame?.(raw),
    setInfo: (next) => {
      info = next;
    },
  };
}

describe('Ecowitt rawFrame + getStationInfo (local)', () => {
  it('re-emits a poll raw frame as a rawFrame event with source "poll"', async () => {
    const fake = fakeLocal();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    const frames: RawFrame[] = [];
    client.on('rawFrame', (f) => frames.push(f));
    await client.start();
    const raw: RawLiveData = { common_list: [{ id: '0x02', val: '6.3' }] };
    fake.fireRawFrame(raw);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.source).toBe('poll');
    expect(frames[0]?.payload).toEqual(raw);
    await client.stop();
  });

  it('exposes getStationInfo() from the local transport', async () => {
    const fake = fakeLocal();
    fake.setInfo({ model: 'GW2000A_V3.1.5', firmware: '1.2.3' });
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    expect(client.getStationInfo()).toEqual({ model: 'GW2000A_V3.1.5', firmware: '1.2.3' });
    await client.stop();
  });

  it('getStationInfo() defaults to {} when the transport has none', async () => {
    const fake = fakeLocal();
    const client = __createLocalWith({ host: 'x' }, (o) => fake.build(o));
    expect(client.getStationInfo()).toEqual({});
    await client.stop();
  });
});
