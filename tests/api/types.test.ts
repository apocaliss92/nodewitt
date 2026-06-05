import { describe, it, expectTypeOf } from 'vitest';
import type { LocalOptions, ListenerOptions, EcowittEvents } from '../../src/api/types.js';
import type { Sensor } from '../../src/model/sensor.js';
import type { StationSnapshot } from '../../src/model/station.js';

describe('public api types', () => {
  it('LocalOptions requires host and allows the documented optionals', () => {
    expectTypeOf<LocalOptions>().toMatchTypeOf<{ host: string }>();
    expectTypeOf<LocalOptions['port']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LocalOptions['pollIntervalMs']>().toEqualTypeOf<number | undefined>();
  });

  it('ListenerOptions has an optional port', () => {
    expectTypeOf<ListenerOptions['port']>().toEqualTypeOf<number | undefined>();
  });

  it('EcowittEvents maps update/sensorChanged/snapshot/error to their payloads', () => {
    expectTypeOf<EcowittEvents['update']>().toEqualTypeOf<ReadonlyArray<Sensor>>();
    expectTypeOf<EcowittEvents['sensorChanged']>().toEqualTypeOf<Sensor>();
    expectTypeOf<EcowittEvents['error']>().toEqualTypeOf<Error>();
    expectTypeOf<EcowittEvents['snapshot']>().toEqualTypeOf<StationSnapshot>();
  });
});
