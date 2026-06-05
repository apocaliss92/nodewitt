import { describe, it, expect } from 'vitest';
import {
  SensorAccumulator,
  buildCatalog,
  createDumper,
  Dumper,
} from '../../src/diagnostics/dumper.js';
import { TypedEmitter } from '../../src/api/events.js';
import type { EcowittEvents, StationInfo } from '../../src/api/types.js';
import type { StationSnapshot } from '../../src/model/station.js';
import { DeviceDumpSchema } from '../../src/diagnostics/dump-format.js';
import type { Sensor } from '../../src/model/sensor.js';

function sensor(p: Partial<Sensor>): Sensor {
  return {
    id: p.id ?? 'gw:0x02',
    quantity: p.quantity ?? 'temperature',
    value: p.value ?? 6.3,
    unit: p.unit ?? '°C',
    raw: p.raw ?? '6.3',
    lastUpdated: p.lastUpdated ?? 1000,
    ...(p.hardwareId !== undefined ? { hardwareId: p.hardwareId } : {}),
    ...(p.model !== undefined ? { model: p.model } : {}),
    ...(p.channel !== undefined ? { channel: p.channel } : {}),
    ...(p.battery !== undefined ? { battery: p.battery } : {}),
    ...(p.batteryUnit !== undefined ? { batteryUnit: p.batteryUnit } : {}),
    ...(p.signal !== undefined ? { signal: p.signal } : {}),
  };
}

describe('SensorAccumulator', () => {
  it('accumulates distinct quantity values under sensor:<quantity> with enum + counts', () => {
    const acc = new SensorAccumulator();
    acc.recordSensor(sensor({ quantity: 'temperature', value: 6.3 }), 1000);
    acc.recordSensor(sensor({ quantity: 'temperature', value: 7.1 }), 2000);
    acc.recordSensor(sensor({ quantity: 'temperature', value: 6.3 }), 3000); // dup value
    const snap = acc.snapshot();
    const t = snap['sensor:temperature'];
    expect(t).toBeDefined();
    expect(t?.values).toEqual([6.3, 7.1]);
    expect(t?.enum).toBe('temperature');
    expect(t?.count).toBe(3);
    expect(t?.firstSeen).toBe(1000);
    expect(t?.lastSeen).toBe(3000);
    expect(t?.unmapped).toEqual([]);
  });

  it('flags a sensor model NOT in the protocol tables as unmapped (wh99) but not a known one (wh31)', () => {
    const acc = new SensorAccumulator();
    acc.recordSensor(sensor({ model: 'wh31', channel: 1 }), 1000);
    acc.recordSensor(sensor({ model: 'wh99', channel: 1 }), 1000); // fictional img -> [] keys
    const snap = acc.snapshot();
    expect(snap['model:wh31']?.unmapped).toEqual([]);
    expect(snap['model:wh99']?.unmapped).toEqual(['wh99']);
  });

  it('flags an unknown raw measurement key (foobar99) as unmapped, known keys not', () => {
    const acc = new SensorAccumulator();
    acc.recordRawKey('tempf', '50.0', 1000); // classifyKey -> measurement
    acc.recordRawKey('0x02', '6.3', 1000); // measurement
    acc.recordRawKey('foobar99', 'x', 1000); // unknown
    const snap = acc.snapshot();
    expect(snap['key:foobar99']?.unmapped).toEqual(['foobar99']);
    expect(snap['key:tempf']).toBeUndefined(); // known keys are not recorded as key:* entries
    expect(snap['key:0x02']).toBeUndefined();
  });

  it('flags an undecodable battery encoding as unmapped, a decodable one not', () => {
    const acc = new SensorAccumulator();
    acc.recordRawKey('wh40batt', '0', 1000); // binary -> 100% (decodable)
    acc.recordRawKey('soilbatt1', '4', 1000); // bar -> 80% (decodable)
    acc.recordRawKey('wh90batt', 'NaNvolts', 1000); // voltage -> null (undecodable)
    const snap = acc.snapshot();
    expect(snap['battery:wh40batt']).toBeUndefined(); // decodable -> not flagged
    expect(snap['battery:wh90batt']?.unmapped).toEqual(['wh90batt']);
  });
});

describe('buildCatalog', () => {
  it('lists distinct (model, channel) pairs sorted deterministically + a capabilities summary', () => {
    const sensors: Sensor[] = [
      sensor({ model: 'wh31', channel: 1, quantity: 'temperature' }),
      sensor({ model: 'wh31', channel: 1, quantity: 'humidity' }), // dup pair
      sensor({ model: 'wh31', channel: 2, quantity: 'temperature' }),
      sensor({ model: 'ws90', quantity: 'wind_speed' }),
      sensor({ quantity: 'pressure' }), // no model -> excluded from sensors[]
    ];
    const cat = buildCatalog(sensors);
    expect(cat.sensors).toEqual([
      { model: 'wh31', channel: 1 },
      { model: 'wh31', channel: 2 },
      { model: 'ws90' },
    ]);
    expect(cat.commands).toBeUndefined(); // nodewitt has no commands
    const caps = cat.capabilities;
    expect(caps?.models).toEqual(['wh31', 'ws90']);
  });
});

/** A minimal real-emitter-backed fake satisfying the DumperClient seam (no cast). */
class FakeEcowitt {
  readonly #emitter = new TypedEmitter<EcowittEvents>();
  #sensors: Sensor[] = [];
  #info: StationInfo = {};
  setSensors(s: Sensor[]): void {
    this.#sensors = s;
  }
  setInfo(info: StationInfo): void {
    this.#info = info;
  }
  emitUpdate(s: Sensor[]): void {
    this.#emitter.emit('update', s);
  }
  emitRawFrame(source: 'poll' | 'push', payload: unknown): void {
    this.#emitter.emit('rawFrame', { source, payload });
  }
  on<K extends keyof EcowittEvents>(e: K, l: (p: EcowittEvents[K]) => void): this {
    this.#emitter.on(e, l);
    return this;
  }
  off<K extends keyof EcowittEvents>(e: K, l: (p: EcowittEvents[K]) => void): this {
    this.#emitter.off(e, l);
    return this;
  }
  getSensors(): StationSnapshot['sensors'] {
    return this.#sensors;
  }
  getStationInfo(): StationInfo {
    return this.#info;
  }
  listenerCount(e: keyof EcowittEvents): number {
    return this.#emitter.listenerCount(e);
  }
}

describe('Dumper', () => {
  it('records the live update stream into the accumulator', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client);
    dumper.start();
    client.emitUpdate([sensor({ quantity: 'temperature', value: 6.3, model: 'wh31', channel: 1 })]);
    client.emitUpdate([sensor({ quantity: 'temperature', value: 7.1, model: 'wh99', channel: 1 })]);
    const dump = dumper.export();
    expect(dump.observations.properties['sensor:temperature']?.values).toContain(6.3);
    expect(dump.observations.properties['model:wh99']?.unmapped).toEqual(['wh99']);
    expect(dump.observations.properties['model:wh31']?.unmapped).toEqual([]);
    dumper.stop();
  });

  it('start/stop are idempotent and stop removes exactly the dumper listeners (no leak)', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client, { captureRawFrames: true });
    expect(client.listenerCount('update')).toBe(0);
    expect(client.listenerCount('rawFrame')).toBe(0);
    dumper.start();
    dumper.start(); // idempotent
    const after =
      client.listenerCount('update') +
      client.listenerCount('sensorChanged') +
      client.listenerCount('rawFrame');
    dumper.stop();
    dumper.stop(); // idempotent
    expect(client.listenerCount('update')).toBe(0);
    expect(client.listenerCount('sensorChanged')).toBe(0);
    expect(client.listenerCount('rawFrame')).toBe(0);
    expect(after).toBeGreaterThan(0);
  });

  it('does not subscribe to rawFrame unless captureRawFrames is on', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client);
    dumper.start();
    expect(client.listenerCount('rawFrame')).toBe(0);
    dumper.stop();
  });

  it('auto-captures push rawFrames: scrubs secrets, flags unknown keys', () => {
    const client = new FakeEcowitt();
    client.setSensors([sensor({ model: 'wh31', channel: 1, quantity: 'temperature' })]);
    const dumper = createDumper(client, { captureRawFrames: true });
    dumper.start();
    // a raw push frame carrying secrets + an unknown key + an undecodable battery
    client.emitRawFrame('push', {
      PASSKEY: 'A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4',
      mac: '34:94:54:AA:BB:CC',
      ssid: 'HomeNet',
      tempf: '50.0',
      foobar99: 'x',
    });
    const json = dumper.exportJson();
    expect(json).not.toContain('A1B2C3D4E5F6'); // PASSKEY scrubbed
    expect(json).not.toContain('34:94:54'); // mac scrubbed
    expect(json).not.toContain('HomeNet'); // ssid scrubbed
    const dump = dumper.export();
    expect(DeviceDumpSchema.safeParse(dump).success).toBe(true);
    expect(dump.observations.properties['key:foobar99']?.unmapped).toEqual(['foobar99']);
    expect(dump.observations.rawFrames?.length).toBe(1);
    expect(dump.library).toBe('nodewitt');
    expect(dump.catalog.sensors).toEqual([{ model: 'wh31', channel: 1 }]);
    dumper.stop();
  });

  it('auto-captures poll rawFrames: flags an unknown hex id in common_list', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client, { captureRawFrames: true });
    dumper.start();
    client.emitRawFrame('poll', {
      common_list: [
        { id: '0x02', val: '6.3' }, // known -> not flagged
        { id: '0xFE', val: '123' }, // fictional hex id -> unknown -> flagged
      ],
    });
    const dump = dumper.export();
    expect(dump.observations.properties['key:0xFE']?.unmapped).toEqual(['0xFE']);
    expect(dump.observations.properties['key:0x02']).toBeUndefined();
    dumper.stop();
  });

  it('uses getStationInfo() for device model/firmware (anonymized)', () => {
    const client = new FakeEcowitt();
    client.setInfo({ model: 'GW2000A_V3.1.5', firmware: 'V3.1.5' });
    const dumper = createDumper(client);
    dumper.start();
    const dump = dumper.export();
    expect(dump.device.model).toBe('GW2000A_V3.1.5');
    expect(dump.device.firmware).toBe('V3.1.5');
    expect(dump.device.type).toBe('weather-station');
    dumper.stop();
  });

  it('falls back to the generic "ecowitt" model when station info is empty', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client);
    dumper.start();
    const dump = dumper.export();
    expect(dump.device.model).toBe('ecowitt');
    expect(dump.device.firmware).toBeUndefined();
    dumper.stop();
  });

  it('bounds retained raw frames by maxRawFrames', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client, { captureRawFrames: true, maxRawFrames: 2 });
    dumper.start();
    for (let i = 0; i < 5; i += 1) {
      client.emitRawFrame('push', { tempf: String(i) });
    }
    const dump = dumper.export();
    expect(dump.observations.rawFrames?.length).toBe(2);
    dumper.stop();
  });

  it('exports a deterministic dump (two exports of the same state are equal modulo timestamps)', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client);
    dumper.start();
    client.emitUpdate([sensor({ quantity: 'temperature', value: 6.3 })]);
    const a = dumper.export();
    const b = dumper.export();
    expect(a.observations.properties).toEqual(b.observations.properties);
    dumper.stop();
  });

  it('export works after stop', () => {
    const client = new FakeEcowitt();
    const dumper = createDumper(client);
    dumper.start();
    client.emitUpdate([sensor({ quantity: 'humidity', value: 55 })]);
    dumper.stop();
    expect(dumper.export().observations.properties['sensor:humidity']).toBeDefined();
  });

  it('createDumper returns a Dumper instance', () => {
    expect(createDumper(new FakeEcowitt())).toBeInstanceOf(Dumper);
  });
});
