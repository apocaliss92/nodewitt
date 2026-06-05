import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalPoller, type PollerEndpoints } from '../../src/local/poller.js';
import type { RawLiveData } from '../../src/local/livedata.js';
import type { GatewayVersion, SensorInfo } from '../../src/local/endpoints.js';

const SENSORS: SensorInfo[] = [
  { id: 'A1', img: 'wh90', name: 'Solar & Wind & Rain', signal: '4', batt: '5' },
];
const LIVE: RawLiveData = { common_list: [{ id: '0x02', val: '20.0' }] };
const VERSION: GatewayVersion = {
  version: 'V3.1.5',
  stationtype: 'GW2000A_V3.1.5',
  sensoridPage: 1,
};

// Minimal Endpoints double — only the methods the poller calls.
function makeEndpoints(
  over: Partial<{
    live: PollerEndpoints['getLiveData'];
    sensors: PollerEndpoints['getAllSensors'];
    units: PollerEndpoints['getUnits'];
    version: PollerEndpoints['getVersion'];
  }> = {},
): {
  getLiveData: ReturnType<typeof vi.fn>;
  getAllSensors: ReturnType<typeof vi.fn>;
  getUnits: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
} {
  return {
    getLiveData: vi.fn(over.live ?? (async (): Promise<RawLiveData> => LIVE)),
    getAllSensors: vi.fn(over.sensors ?? (async (): Promise<SensorInfo[]> => SENSORS)),
    getUnits: vi.fn(over.units ?? (async (): Promise<Record<string, unknown>> => ({}))),
    getVersion: vi.fn(over.version ?? (async (): Promise<GatewayVersion> => VERSION)),
  };
}

describe('LocalPoller', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits decoded readings on the live cadence and re-reads the map on the mapping cadence', async () => {
    const endpoints = makeEndpoints();
    const batches: unknown[][] = [];
    const poller = new LocalPoller({
      endpoints,
      scanIntervalMs: 60_000,
      mappingIntervalMs: 600_000,
      onReadings: (r) => batches.push(r),
      onError: () => {},
    });

    await poller.start();
    // immediate mapping refresh + immediate live poll
    expect(endpoints.getAllSensors).toHaveBeenCalledTimes(1);
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(1);
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches[0]!.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(60_000); // one live tick
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(2);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    // mapping must NOT have re-read yet (only the scan cadence elapsed)
    expect(endpoints.getAllSensors).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(540_000); // total 600s -> one mapping tick
    expect(endpoints.getAllSensors.mock.calls.length).toBeGreaterThanOrEqual(2);

    poller.stop();
  });

  it('resolves the WH90 readings to a hardware id via the live mapping (forceHardwareId not needed for 0x02)', async () => {
    const endpoints = makeEndpoints();
    const batches: Array<Array<{ key: string; hardwareId: string | undefined }>> = [];
    const poller = new LocalPoller({
      endpoints,
      onReadings: (r) => batches.push(r),
      onError: () => {},
    });

    await poller.start();
    const first = batches[0]!;
    const reading = first.find((r) => r.key === '0x02');
    expect(reading?.hardwareId).toBe('A1'); // wh90 claims 0x02 -> mapped to A1

    poller.stop();
  });

  it('decodes channelized temps as Fahrenheit (converted to °C) when the gateway unit is "1"', async () => {
    const endpoints = makeEndpoints({
      sensors: async (): Promise<SensorInfo[]> => [
        { id: 'W31', img: 'wh31', name: 'Temp CH1', signal: '4' },
      ],
      live: async (): Promise<RawLiveData> => ({
        common_list: [{ id: '0x02', val: '20.0' }],
        ch_aisle: [{ channel: '1', temp: '72.0', humidity: '48%', battery: '0' }],
      }),
      units: async (): Promise<Record<string, unknown>> => ({ temperature: '1' }),
    });
    const batches: Array<Array<{ key: string; value: number; unit: string }>> = [];
    const poller = new LocalPoller({
      endpoints,
      onReadings: (r) => batches.push(r),
      onError: () => {},
    });

    await poller.start();
    const temp = batches[0]!.find((r) => r.key === 'temp1f');
    // gateway reports °F -> 72°F normalizes to (72-32)/1.8 = 22.22°C
    expect(temp?.unit).toBe('°C');
    expect(temp?.value).toBeCloseTo(22.22, 1);

    poller.stop();
  });

  it('decodes channelized temps as Celsius (no conversion) when the gateway unit is "0"', async () => {
    const endpoints = makeEndpoints({
      sensors: async (): Promise<SensorInfo[]> => [
        { id: 'W31', img: 'wh31', name: 'Temp CH1', signal: '4' },
      ],
      live: async (): Promise<RawLiveData> => ({
        common_list: [{ id: '0x02', val: '20.0' }],
        ch_aisle: [{ channel: '1', temp: '72.0', humidity: '48%', battery: '0' }],
      }),
      units: async (): Promise<Record<string, unknown>> => ({ temperature: '0' }),
    });
    const batches: Array<Array<{ key: string; value: number; unit: string }>> = [];
    const poller = new LocalPoller({
      endpoints,
      onReadings: (r) => batches.push(r),
      onError: () => {},
    });

    await poller.start();
    const temp = batches[0]!.find((r) => r.key === 'temp1f');
    // gateway reports °C -> 72 stays 72 (no Fahrenheit conversion)
    expect(temp?.unit).toBe('C');
    expect(temp?.value).toBeCloseTo(72.0, 1);

    poller.stop();
  });

  it('never assigns a hardware id to gateway-owned indoor keys', async () => {
    const endpoints = makeEndpoints({
      live: async (): Promise<RawLiveData> => ({
        common_list: [{ id: '0x02', val: '20.0' }],
        wh25: [{ intemp: '21.0', inhumi: '40%', unit: 'C' }],
      }),
    });
    const batches: Array<Array<{ key: string; hardwareId: string | undefined }>> = [];
    const poller = new LocalPoller({
      endpoints,
      onReadings: (r) => batches.push(r),
      onError: () => {},
    });

    await poller.start();
    const tempin = batches[0]!.find((r) => r.key === 'tempinf');
    expect(tempin).toBeDefined();
    expect(tempin?.hardwareId).toBeUndefined();

    poller.stop();
  });

  it('survives a failed live poll: onError is called and the next tick still fires', async () => {
    let calls = 0;
    const endpoints = makeEndpoints({
      live: async (): Promise<RawLiveData> => {
        calls += 1;
        if (calls === 2) throw new Error('gateway offline');
        return LIVE;
      },
    });
    const errors: unknown[] = [];
    let emitted = 0;
    const poller = new LocalPoller({
      endpoints,
      scanIntervalMs: 60_000,
      mappingIntervalMs: 600_000,
      onReadings: () => {
        emitted += 1;
      },
      onError: (e) => errors.push(e),
    });

    await poller.start(); // poll #1 ok
    expect(emitted).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000); // poll #2 throws
    expect(errors.length).toBe(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect(emitted).toBe(1); // failed poll did not emit

    await vi.advanceTimersByTimeAsync(60_000); // poll #3 ok again — scheduler survived
    expect(emitted).toBe(2);
    expect(calls).toBe(3);

    poller.stop();
  });

  it('survives a failed mapping refresh and keeps polling', async () => {
    const endpoints = makeEndpoints({
      sensors: async (): Promise<SensorInfo[]> => {
        throw new Error('sensors endpoint down');
      },
    });
    const errors: unknown[] = [];
    let emitted = 0;
    const poller = new LocalPoller({
      endpoints,
      onReadings: () => {
        emitted += 1;
      },
      onError: (e) => errors.push(e),
    });

    await poller.start();
    // mapping failed but the live poll still ran and emitted
    expect(errors.length).toBe(1);
    expect(emitted).toBe(1);

    poller.stop();
  });

  it('stop() clears both timers so no further polls fire', async () => {
    const endpoints = makeEndpoints();
    const poller = new LocalPoller({
      endpoints,
      scanIntervalMs: 60_000,
      mappingIntervalMs: 600_000,
      onReadings: () => {},
      onError: () => {},
    });

    await poller.start();
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(1);
    poller.stop();

    await vi.advanceTimersByTimeAsync(600_000);
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(1); // no more polls
    expect(endpoints.getAllSensors).toHaveBeenCalledTimes(1); // no more mapping refreshes
  });

  it('rejects a second start() without leaking the original timers', async () => {
    const endpoints = makeEndpoints();
    const poller = new LocalPoller({ endpoints, onReadings: () => {}, onError: () => {} });

    await poller.start();
    await expect(poller.start()).rejects.toThrow('LocalPoller already started');

    // The original schedule is intact and unduplicated: exactly one extra poll per cadence tick.
    const pollsAfterStart = endpoints.getLiveData.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(pollsAfterStart + 1);

    poller.stop();
  });

  it('allows start() again after a stop() (started state resets)', async () => {
    const endpoints = makeEndpoints();
    const poller = new LocalPoller({ endpoints, onReadings: () => {}, onError: () => {} });

    await poller.start();
    poller.stop();
    await expect(poller.start()).resolves.toBeUndefined();

    poller.stop();
  });

  it('forwards the raw /get_livedata_info object to onRawFrame each poll', async () => {
    const endpoints = makeEndpoints();
    const frames: RawLiveData[] = [];
    const poller = new LocalPoller({
      endpoints,
      onReadings: () => {},
      onError: () => {},
      onRawFrame: (raw) => frames.push(raw),
    });

    await poller.start();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual(LIVE);

    poller.stop();
  });

  it('captures the gateway model/firmware from /get_version into getStationInfo()', async () => {
    const endpoints = makeEndpoints();
    const poller = new LocalPoller({ endpoints, onReadings: () => {}, onError: () => {} });

    expect(poller.getStationInfo()).toEqual({});
    await poller.start();
    expect(poller.getStationInfo()).toEqual({ model: 'GW2000A_V3.1.5', firmware: 'V3.1.5' });

    poller.stop();
  });

  it('uses the default 60s / 600s cadence when intervals are omitted', async () => {
    const endpoints = makeEndpoints();
    const poller = new LocalPoller({ endpoints, onReadings: () => {}, onError: () => {} });

    await poller.start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(endpoints.getLiveData).toHaveBeenCalledTimes(2); // default 60s elapsed

    poller.stop();
  });
});
