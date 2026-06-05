/**
 * Typed, Zod-validated wrappers over the Ecowitt local endpoints.
 *
 * Ported from the MIT `ecowitt_local` `api.py` + `const.py`. Each public method validates the
 * gateway's JSON at the boundary with Zod (`.parse()` narrows `unknown` — no cast) and throws a
 * clear error on a malformed shape. The two `/get_cli_*` endpoints are optional and feature-detected:
 * any error or non-array response yields `[]`.
 */

import { z } from 'zod';
import type { HttpClient } from './http-client.js';

// --- Endpoint paths (const.py API_*) ---
const PATH = {
  liveData: '/get_livedata_info',
  sensors: '/get_sensors_info',
  version: '/get_version',
  units: '/get_units_info',
  soilCalibration: '/get_cli_soilad',
  ldsConfig: '/get_cli_lds',
} as const;

const DEAD_IDS = new Set(['FFFFFFFE', 'FFFFFFFF', '00000000']);

// --- Schemas (lenient: the gateway adds fields freely; we keep the ones we use) ---
const versionSchema = z
  .object({
    version: z.string().optional(),
    stationtype: z.string().optional(),
    sensorid_page: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const liveDataItemSchema = z
  .object({ id: z.string().optional(), val: z.union([z.string(), z.number()]).optional() })
  .passthrough();

const liveDataSchema = z
  .object({ common_list: z.array(liveDataItemSchema).optional() })
  .passthrough();

const sensorSchema = z
  .object({
    id: z.string(),
    img: z.string().optional().default(''),
    name: z.string().optional().default(''),
    batt: z.union([z.string(), z.number()]).optional(),
    signal: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const sensorsResponseSchema = z.union([
  z.array(sensorSchema),
  z.object({ sensor: z.array(sensorSchema) }).passthrough(),
]);

export type GatewayVersion = { version?: string; stationtype?: string; sensoridPage: number };
export type LiveData = z.infer<typeof liveDataSchema>;
export type SensorInfo = z.infer<typeof sensorSchema>;

function parsePageCount(raw: string | number | undefined): number {
  if (raw === undefined) return 2;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isInteger(n) || n < 1 || n > 16) return 2;
  return n;
}

export class Endpoints {
  constructor(private readonly http: HttpClient) {}

  async getVersion(): Promise<GatewayVersion> {
    const raw = await this.http.getJson(PATH.version);
    const v = versionSchema.parse(raw);
    return {
      ...(v.version !== undefined ? { version: v.version } : {}),
      ...(v.stationtype !== undefined ? { stationtype: v.stationtype } : {}),
      sensoridPage: parsePageCount(v.sensorid_page),
    };
  }

  async getLiveData(): Promise<LiveData> {
    const raw = await this.http.getJson(PATH.liveData);
    const data = liveDataSchema.parse(raw);
    if (data.common_list === undefined) {
      throw new Error('Ecowitt live data invalid: missing common_list');
    }
    return data;
  }

  async getSensors(page: number): Promise<SensorInfo[]> {
    const raw = await this.http.getJson(PATH.sensors, { page: String(page) });
    const parsed = sensorsResponseSchema.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.sensor;
    return list.filter((s) => !DEAD_IDS.has(s.id.trim().toUpperCase()));
  }

  async getAllSensors(): Promise<SensorInfo[]> {
    const { sensoridPage } = await this.getVersion();
    const all: SensorInfo[] = [];
    for (let page = 1; page <= sensoridPage; page += 1) {
      try {
        all.push(...(await this.getSensors(page)));
      } catch {
        // page may not exist on this firmware — skip (donor behavior)
      }
    }
    return all;
  }

  async getUnits(): Promise<Record<string, unknown>> {
    const raw = await this.http.getJson(PATH.units);
    return z.record(z.unknown()).parse(raw);
  }

  async getSoilCalibration(): Promise<Record<string, unknown>[]> {
    return this.optionalArray(PATH.soilCalibration);
  }

  async getLdsConfig(): Promise<Record<string, unknown>[]> {
    return this.optionalArray(PATH.ldsConfig);
  }

  private async optionalArray(path: string): Promise<Record<string, unknown>[]> {
    try {
      const raw = await this.http.getJson(path);
      const parsed = z.array(z.record(z.unknown())).safeParse(raw);
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }
}
