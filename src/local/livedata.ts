/**
 * Pure decoder: Ecowitt local live-data sub-arrays -> flat readings.
 *
 * Ported from the MIT `ecowitt_local` `coordinator.py:_process_live_data`. Each gateway sub-array
 * (common_list / rain / piezoRain / lightning / wh25 / ch_soil / ch_ec / ch_aisle / ch_temp /
 * ch_pm25 / ch_leaf / ch_leak / ch_lds / co2) is decoded into `LiveReading`s using the P1
 * `parseValue` (SI normalization) and battery helpers. The rain (tipping-bucket) and piezoRain
 * (piezo) arrays both register the same hex IDs 0x0D–0x13, so each is force-attributed to the
 * correct hardware id via `forceHardwareId`, mirroring the donor. Batteries embedded in items
 * (WH26 in 0x03, WH40/WH69 in rain 0x13, WS90/WH90/WS85 in piezo 0x13) are emitted as percent.
 *
 * This is a pure function: it never performs I/O. The optional `/get_cli_soilad` and
 * `/get_cli_lds` enrichment the donor fetches inline is supplied by the caller via `extra`.
 */

import {
  decodeChAisle,
  decodeChEc,
  decodeChLds,
  decodeChLeaf,
  decodeChLeak,
  decodeChPm25,
  decodeChSoil,
  decodeChTemp,
  decodeCo2,
} from './livedata-channels.js';
import { makeReading, num, str, stripPercent } from './livedata-helpers.js';

/** Read-only mapper seam the decoder needs to resolve rain/piezo force ids + battery keys. */
export interface HardwareLookup {
  getHardwareId(liveKey: string): string | undefined;
}

export interface LiveReading {
  readonly key: string;
  readonly value: number;
  readonly unit: string;
  readonly raw: string;
  readonly forceHardwareId?: string;
}

type Item = Record<string, unknown>;

/**
 * Lenient input shape — already Zod-validated upstream as passthrough records.
 *
 * Each sub-array is `?: ... | undefined` (not bare `?`) so a Zod-inferred `.optional()`
 * envelope from `Endpoints.getLiveData()` is assignable under `exactOptionalPropertyTypes`;
 * every decoder branch guards on presence (`if (raw.x)`), so an `undefined` sub-array is a no-op.
 */
export interface RawLiveData {
  readonly common_list?: ReadonlyArray<Item> | undefined;
  readonly rain?: ReadonlyArray<Item> | undefined;
  readonly piezoRain?: ReadonlyArray<Item> | undefined;
  readonly lightning?: ReadonlyArray<Item> | undefined;
  readonly wh25?: ReadonlyArray<Item> | undefined;
  readonly ch_soil?: ReadonlyArray<Item> | undefined;
  readonly ch_ec?: ReadonlyArray<Item> | undefined;
  readonly ch_aisle?: ReadonlyArray<Item> | undefined;
  readonly ch_temp?: ReadonlyArray<Item> | undefined;
  readonly ch_pm25?: ReadonlyArray<Item> | undefined;
  readonly ch_leaf?: ReadonlyArray<Item> | undefined;
  readonly ch_leak?: ReadonlyArray<Item> | undefined;
  readonly ch_lds?: ReadonlyArray<Item> | undefined;
  readonly co2?: ReadonlyArray<Item> | undefined;
}

/** Optional enrichment the poller fetches from `/get_cli_*` (donor inline soilad/lds). */
export interface DecodeExtra {
  readonly soilCalibration?: ReadonlyArray<Item>;
  readonly ldsConfig?: ReadonlyArray<Item>;
}

const DEFAULT_GATEWAY_TEMP_UNIT = 'C';

function push(out: LiveReading[], reading: LiveReading | undefined): void {
  if (reading !== undefined) out.push(reading);
}

/** common_list: pass items through by hex id; WH26 battery embedded in the 0x03 (dewpoint) item. */
function decodeCommonList(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const id = str(item, 'id');
    const val = str(item, 'val');
    const unit = str(item, 'unit');
    if (id && val !== undefined) push(out, makeReading(id, val, unit));
    // WH26/WN32 embeds a binary battery in the 0x03 item: "0" -> 100%, else 10%.
    if (id === '0x03') {
      const battery = str(item, 'battery');
      if (battery !== undefined) {
        push(out, makeReading('wh26batt', battery === '0' ? '100' : '10'));
      }
    }
  }
}

/** rain (tipping-bucket WH40/WH69): force the items onto the bucket id; battery on 0x13. */
function decodeRain(items: ReadonlyArray<Item>, mapper: HardwareLookup, out: LiveReading[]): void {
  const rainHwId = mapper.getHardwareId('wh69batt') ?? mapper.getHardwareId('wh40batt');
  for (const item of items) {
    const id = str(item, 'id');
    const val = str(item, 'val');
    if (!id || val === undefined) continue;
    push(out, makeReading(id, val, str(item, 'unit'), rainHwId));
    if (id === '0x13') {
      const battery = str(item, 'battery');
      if (battery) {
        const n = num(battery);
        const pct = n !== undefined && n > 1 ? String(n * 20) : battery === '0' ? '100' : '10';
        const key = mapper.getHardwareId('wh69batt') !== undefined ? 'wh69batt' : 'wh40batt';
        push(out, makeReading(key, pct));
      }
    }
  }
}

// piezo battery key set selected by which battery key the mapper has registered.
interface PiezoKeys {
  readonly batt: string;
  readonly volt: string;
  readonly capField: string;
  readonly capKey: string;
}

function piezoKeysFor(mapper: HardwareLookup): PiezoKeys {
  if (mapper.getHardwareId('ws85batt') !== undefined) {
    return {
      batt: 'ws85batt',
      volt: 'ws85_voltage',
      capField: 'ws85cap_volt',
      capKey: 'ws85cap_volt',
    };
  }
  if (mapper.getHardwareId('ws90batt') !== undefined) {
    return {
      batt: 'ws90batt',
      volt: 'ws90_voltage',
      capField: 'ws90cap_volt',
      capKey: 'ws90cap_volt',
    };
  }
  return {
    batt: 'wh90batt',
    volt: 'wh90_voltage',
    capField: 'ws90cap_volt',
    capKey: 'wh90cap_volt',
  };
}

/** piezoRain (WS90/WH90/WS85): force onto the piezo id; battery + voltages on 0x13. */
function decodePiezo(items: ReadonlyArray<Item>, mapper: HardwareLookup, out: LiveReading[]): void {
  const piezoHwId =
    mapper.getHardwareId('ws85batt') ??
    mapper.getHardwareId('ws90batt') ??
    mapper.getHardwareId('wh90batt');
  for (const item of items) {
    const id = str(item, 'id');
    const val = str(item, 'val');
    if (!id || val === undefined) continue;
    push(out, makeReading(id, val, str(item, 'unit'), piezoHwId));
    if (id !== '0x13') continue;
    const battery = str(item, 'battery');
    if (!battery) continue;
    const keys = piezoKeysFor(mapper);
    const n = num(battery);
    push(out, makeReading(keys.batt, n !== undefined ? String(n * 20) : battery));
    const voltage = str(item, 'voltage');
    if (voltage) push(out, makeReading(keys.volt, voltage));
    const cap = str(item, keys.capField);
    if (cap) push(out, makeReading(keys.capKey, cap));
  }
}

/** lightning (WH57): count/distance/battery. The non-numeric `date` is skipped by makeReading. */
function decodeLightning(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  const item = items[0];
  if (item === undefined) return;
  const count = str(item, 'count');
  if (count !== undefined) push(out, makeReading('lightning_num', count));
  const distance = str(item, 'distance');
  if (distance !== undefined)
    push(out, makeReading('lightning', distance.replace(' km', '').trim()));
  const battery = str(item, 'battery');
  if (battery !== undefined) {
    const n = num(battery);
    push(out, makeReading('wh57batt', n !== undefined ? String(n * 20) : battery));
  }
}

/** wh25 (indoor station): intemp(+unit), inhumi, abs, rel pressures. */
function decodeWh25(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  const item = items[0];
  if (item === undefined) return;
  const intemp = str(item, 'intemp');
  const unit = str(item, 'unit') ?? 'F';
  if (intemp !== undefined) push(out, makeReading('tempinf', intemp, unit));
  const inhumi = str(item, 'inhumi');
  if (inhumi !== undefined) push(out, makeReading('humidityin', stripPercent(inhumi)));
  const abs = str(item, 'abs');
  if (abs !== undefined) push(out, makeReading('baromabsin', abs.replace(' hPa', '').trim()));
  const rel = str(item, 'rel');
  if (rel !== undefined) push(out, makeReading('baromrelin', rel.replace(' hPa', '').trim()));
}

/** Soil AD calibration enrichment (/get_cli_soilad): nowAd per channel -> soilad{ch}. */
function decodeSoilCalibration(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = str(item, 'ch');
    const nowAd = str(item, 'nowAd');
    if (ch && nowAd !== undefined) push(out, makeReading(`soilad${ch}`, nowAd));
  }
}

/** LDS config enrichment (/get_cli_lds): level + total_heat per channel. */
function decodeLdsConfig(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = str(item, 'ch');
    if (!ch) continue;
    const level = str(item, 'level');
    if (level !== undefined && level !== 'None') push(out, makeReading(`lds_level_ch${ch}`, level));
    const totalHeat = str(item, 'total_heat');
    if (totalHeat !== undefined && totalHeat !== 'None') {
      push(out, makeReading(`lds_total_heat_ch${ch}`, totalHeat));
    }
  }
}

/**
 * Decode a full live-data payload into flat readings, in the donor's sub-array order.
 *
 * `mapper` resolves the rain/piezo `forceHardwareId` overlap and selects the embedded-battery
 * key. `extra` supplies the optional `/get_cli_*` enrichment the poller fetched out-of-band.
 * `gatewayTempUnit` is the unit the gateway reports channelized temperatures in (donor default "C").
 */
export function decodeLiveData(
  raw: RawLiveData,
  mapper: HardwareLookup,
  extra: DecodeExtra = {},
  gatewayTempUnit: string = DEFAULT_GATEWAY_TEMP_UNIT,
): LiveReading[] {
  const out: LiveReading[] = [];

  if (raw.common_list) decodeCommonList(raw.common_list, out);
  if (raw.rain) decodeRain(raw.rain, mapper, out);
  if (raw.lightning) decodeLightning(raw.lightning, out);
  if (raw.ch_soil) decodeChSoil(raw.ch_soil, out);
  if (raw.ch_ec) decodeChEc(raw.ch_ec, out);
  if (raw.wh25) decodeWh25(raw.wh25, out);
  if (raw.piezoRain) decodePiezo(raw.piezoRain, mapper, out);
  if (raw.ch_aisle) decodeChAisle(raw.ch_aisle, gatewayTempUnit, out);
  if (raw.ch_temp) decodeChTemp(raw.ch_temp, gatewayTempUnit, out);
  if (raw.ch_pm25) decodeChPm25(raw.ch_pm25, out);
  if (raw.ch_leaf) decodeChLeaf(raw.ch_leaf, out);
  if (raw.ch_leak) decodeChLeak(raw.ch_leak, out);
  if (raw.ch_lds) decodeChLds(raw.ch_lds, out);
  if (raw.co2) decodeCo2(raw.co2, out);
  if (extra.soilCalibration) decodeSoilCalibration(extra.soilCalibration, out);
  if (extra.ldsConfig) decodeLdsConfig(extra.ldsConfig, out);

  return out;
}
