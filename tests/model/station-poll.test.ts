import { describe, it, expect } from 'vitest';
import { Station } from '../../src/model/station.js';
import type { ResolvedReading } from '../../src/local/poller.js';
import type { MappedSensor } from '../../src/local/sensor-mapper.js';

const info: Record<string, MappedSensor> = {
  AABBCC: { hardwareId: 'AABBCC', model: 'wh31', channel: 1, battery: '0', signal: '4' },
};
const lookup = { getSensorInfo: (id: string): MappedSensor | undefined => info[id] };

function poll(
  over: Partial<ResolvedReading> & Pick<ResolvedReading, 'key' | 'value' | 'unit' | 'raw'>,
): ResolvedReading {
  return { hardwareId: undefined, ...over };
}

describe('Station.ingestPollReadings', () => {
  it('creates a measurement sensor keyed by hardwareId, with model/channel/signal from the map', () => {
    const station = new Station();
    const changed = station.ingestPollReadings(
      [poll({ key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'AABBCC' })],
      lookup,
      1000,
    );
    const sensors = station.getSensors();
    const s = sensors.find((x) => x.hardwareId === 'AABBCC' && x.quantity === 'temperature');
    expect(s?.value).toBe(20);
    expect(s?.model).toBe('wh31');
    expect(s?.channel).toBe(1);
    expect(s?.signal).toBe(4);
    expect(s?.lastUpdated).toBe(1000);
    expect(changed.length).toBeGreaterThanOrEqual(1);
  });

  it('attaches an already-percent battery to its owner WITHOUT re-decoding', () => {
    const station = new Station();
    // The poll decoders already turned the battery into a percent value (e.g. soilbatt1 = 80).
    station.ingestPollReadings(
      [
        poll({ key: 'soilmoisture1', value: 33, unit: '%', raw: '33', hardwareId: 'AABBCC' }),
        poll({ key: 'soilbatt1', value: 80, unit: '%', raw: '80', hardwareId: 'AABBCC' }),
      ],
      lookup,
      1000,
    );
    const owner = station
      .getSensors()
      .find((s) => s.hardwareId === 'AABBCC' && s.quantity === 'humidity');
    expect(owner?.battery).toBe(80);
    expect(owner?.batteryUnit).toBe('%');
    // The battery key itself is NOT surfaced as its own measurement sensor.
    expect(station.getSensors().some((s) => s.raw === '80' && s.quantity !== 'humidity')).toBe(
      false,
    );
  });

  it('carries a raw-voltage battery as volts (no percent math)', () => {
    const station = new Station();
    station.ingestPollReadings(
      [
        poll({ key: '0x0B', value: 2.2, unit: 'm/s', raw: '2.2', hardwareId: 'AABBCC' }),
        poll({ key: 'ws90_voltage', value: 2.7, unit: 'V', raw: '2.7', hardwareId: 'AABBCC' }),
      ],
      lookup,
      1000,
    );
    const owner = station
      .getSensors()
      .find((s) => s.hardwareId === 'AABBCC' && s.quantity === 'wind_speed');
    expect(owner?.battery).toBe(2.7);
    expect(owner?.batteryUnit).toBe('V');
  });

  it('keys gateway-owned readings (hardwareId undefined) under a synthetic gateway owner', () => {
    const station = new Station();
    station.ingestPollReadings(
      [poll({ key: 'tempinf', value: 22, unit: '°C', raw: '71.6 F' })],
      lookup,
      1000,
    );
    const s = station
      .getSensors()
      .find((x) => x.quantity === 'temperature' && x.hardwareId === undefined);
    expect(s?.value).toBe(22);
    expect(s?.id.startsWith('gateway')).toBe(true);
  });

  it('merges a second poll for the same key into the same sensor (no duplicate)', () => {
    const station = new Station();
    station.ingestPollReadings(
      [poll({ key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'AABBCC' })],
      lookup,
      1000,
    );
    const changed = station.ingestPollReadings(
      [poll({ key: 'temp1f', value: 21, unit: '°C', raw: '69.8 F', hardwareId: 'AABBCC' })],
      lookup,
      2000,
    );
    const temps = station
      .getSensors()
      .filter((s) => s.hardwareId === 'AABBCC' && s.quantity === 'temperature');
    expect(temps).toHaveLength(1);
    expect(temps[0]?.value).toBe(21);
    expect(changed).toHaveLength(1); // value changed → one change emitted
  });

  it('does not report a change when the value is identical', () => {
    const station = new Station();
    station.ingestPollReadings(
      [poll({ key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'AABBCC' })],
      lookup,
      1000,
    );
    const changed = station.ingestPollReadings(
      [poll({ key: 'temp1f', value: 20, unit: '°C', raw: '68 F', hardwareId: 'AABBCC' })],
      lookup,
      2000,
    );
    expect(changed).toHaveLength(0);
  });
});
