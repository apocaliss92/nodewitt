import { describe, it, expect } from 'vitest';
import { HttpClient, type FetchImpl, type FetchResponse } from '../../src/local/http-client.js';
import { Endpoints } from '../../src/local/endpoints.js';

function res(body: unknown, status = 200): FetchResponse {
  return { statusCode: status, json: async () => body, text: async () => JSON.stringify(body) };
}
function routed(map: Record<string, unknown>): FetchImpl {
  return async (url) => {
    const path = new URL(url).pathname;
    if (path in map) return res(map[path]);
    return res({}, 404);
  };
}
function endpoints(fetchImpl: FetchImpl): Endpoints {
  return new Endpoints(new HttpClient({ host: 'h', port: 80, fetchImpl }));
}

describe('Endpoints', () => {
  it('getVersion parses firmware + sensorid_page', async () => {
    const e = endpoints(
      routed({
        '/get_version': { stationtype: 'GW1100A', version: '1.7.3', sensorid_page: '2' },
      }),
    );
    const v = await e.getVersion();
    expect(v.version).toBe('1.7.3');
    expect(v.sensoridPage).toBe(2);
  });

  it('getLiveData accepts a common_list payload', async () => {
    const e = endpoints(
      routed({ '/get_livedata_info': { common_list: [{ id: '0x02', val: '20.0' }] } }),
    );
    const live = await e.getLiveData();
    expect(live.common_list?.length).toBe(1);
  });

  it('getLiveData rejects a payload missing common_list with a clear error', async () => {
    const e = endpoints(routed({ '/get_livedata_info': { wh25: [] } }));
    await expect(e.getLiveData()).rejects.toThrow(/common_list/);
  });

  it('getSensors filters dead ids and unwraps {sensor:[...]}', async () => {
    const e = endpoints(
      routed({
        '/get_sensors_info': {
          sensor: [
            { id: 'D1E2F3', img: 'wh31', name: 'Temp & Humidity CH1', signal: '4' },
            { id: 'FFFFFFFF', img: 'wh31', name: 'Temp & Humidity CH2', signal: '0' },
            { id: '00000000', img: 'wh51', name: 'Soil moisture CH1', signal: '0' },
          ],
        },
      }),
    );
    const sensors = await e.getSensors(1);
    expect(sensors.map((s) => s.id)).toEqual(['D1E2F3']);
  });

  it('getSensors accepts a bare-array response shape too', async () => {
    const e = endpoints(
      routed({
        '/get_sensors_info': [
          { id: 'AA11BB', img: 'wh51', name: 'Soil moisture CH2', signal: '3' },
        ],
      }),
    );
    const sensors = await e.getSensors(1);
    expect(sensors.map((s) => s.id)).toEqual(['AA11BB']);
  });

  it('getAllSensors loops every page reported by sensorid_page and concatenates', async () => {
    let page1Hits = 0;
    const fetchImpl: FetchImpl = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/get_version') return res({ sensorid_page: '3' });
      if (u.pathname === '/get_sensors_info') {
        const page = u.searchParams.get('page');
        if (page === '1') {
          page1Hits += 1;
          return res({ sensor: [{ id: 'P1', img: 'wh31', name: 'CH1', signal: '4' }] });
        }
        if (page === '2')
          return res({ sensor: [{ id: 'P2', img: 'wh31', name: 'CH2', signal: '4' }] });
        return res({}, 500); // page 3 fails -> skipped, not fatal
      }
      return res({}, 404);
    };
    const e = endpoints(fetchImpl);
    const all = await e.getAllSensors();
    expect(all.map((s) => s.id)).toEqual(['P1', 'P2']);
    expect(page1Hits).toBe(1);
  });

  it('getVersion clamps an out-of-range sensorid_page to the fallback of 2', async () => {
    const e = endpoints(routed({ '/get_version': { sensorid_page: '99' } }));
    expect((await e.getVersion()).sensoridPage).toBe(2);
  });

  it('getUnits returns the opaque record as-is', async () => {
    const e = endpoints(routed({ '/get_units_info': { temperature: '1', pressure: '0' } }));
    expect(await e.getUnits()).toEqual({ temperature: '1', pressure: '0' });
  });

  it('getSoilCalibration returns [] when the optional endpoint is absent', async () => {
    const e = endpoints(routed({})); // every path -> 404
    expect(await e.getSoilCalibration()).toEqual([]);
  });

  it('getLdsConfig returns the parsed array when the optional endpoint is present', async () => {
    const e = endpoints(routed({ '/get_cli_lds': [{ ch: '1', level: '50' }] }));
    expect(await e.getLdsConfig()).toEqual([{ ch: '1', level: '50' }]);
  });

  it('getSoilCalibration returns [] when the endpoint returns a non-array shape', async () => {
    const e = endpoints(routed({ '/get_cli_soilad': { not: 'an array' } }));
    expect(await e.getSoilCalibration()).toEqual([]);
  });
});
