import { describe, it, expect } from 'vitest';
import { SensorAccumulator, buildCatalog } from '../../src/diagnostics/dumper.js';
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
