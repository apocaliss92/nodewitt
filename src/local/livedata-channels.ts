/**
 * Channelized + combo sub-array decoders for the Ecowitt local live-data.
 *
 * Extracted from `livedata.ts` (house rule: many small functions) — ported from the MIT
 * `ecowitt_local` `coordinator.py:_process_live_data`. Each function decodes one gateway
 * sub-array (ch_soil / ch_ec / ch_aisle / ch_temp / ch_pm25 / ch_leaf / ch_leak / ch_lds / co2)
 * into flat `LiveReading`s. The shared `Emit`/helpers come from `livedata.ts` to avoid any
 * duplication of the value/unit/battery logic.
 */

import type { LiveReading } from './livedata.js';
import { batteryPercent, makeReading, num, str, stripPercent } from './livedata-helpers.js';

type Item = Record<string, unknown>;

/** Channel as a positive-integer string, or undefined when absent/invalid (donor truthiness). */
function channelOf(item: Item): string | undefined {
  const ch = str(item, 'channel');
  return ch && ch.trim() !== '' ? ch.trim() : undefined;
}

function push(out: LiveReading[], reading: LiveReading | undefined): void {
  if (reading !== undefined) out.push(reading);
}

/** WH51 soil moisture + binary-or-bar battery. */
export function decodeChSoil(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const humidity = stripPercent(str(item, 'humidity'));
    const battery = str(item, 'battery');
    if (humidity) push(out, makeReading(`soilmoisture${ch}`, humidity));
    if (battery) push(out, makeReading(`soilbatt${ch}`, batteryPercent(battery, true)));
  }
}

/** WH52 soil moisture + temperature(+unit) + EC + bar battery. */
export function decodeChEc(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const humidity = stripPercent(str(item, 'humidity'));
    const temp = str(item, 'temp');
    const unit = str(item, 'unit') ?? 'C';
    const ec = str(item, 'ec');
    const battery = str(item, 'battery');
    if (humidity) push(out, makeReading(`soilmoisture${ch}`, humidity));
    if (temp) push(out, makeReading(`soiltemp${ch}`, temp, unit));
    if (ec) push(out, makeReading(`soilec${ch}`, ec));
    if (battery && battery !== 'None') {
      push(out, makeReading(`soilbatt${ch}`, batteryPercent(battery, false)));
    }
  }
}

/** WH31 temp(+gateway unit)/humidity/binary-or-bar battery. */
export function decodeChAisle(
  items: ReadonlyArray<Item>,
  gatewayTempUnit: string,
  out: LiveReading[],
): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const temp = str(item, 'temp');
    const humidity = str(item, 'humidity');
    const battery = str(item, 'battery');
    if (temp && temp !== 'None') push(out, makeReading(`temp${ch}f`, temp, gatewayTempUnit));
    if (humidity && humidity !== 'None') {
      push(out, makeReading(`humidity${ch}`, stripPercent(humidity)));
    }
    if (battery && battery !== 'None') {
      push(out, makeReading(`batt${ch}`, batteryPercent(battery, true)));
    }
  }
}

/** WH34 wired temp(+gateway unit) + bar battery. */
export function decodeChTemp(
  items: ReadonlyArray<Item>,
  gatewayTempUnit: string,
  out: LiveReading[],
): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const temp = str(item, 'temp');
    const battery = str(item, 'battery');
    if (temp && temp !== 'None') push(out, makeReading(`tf_ch${ch}`, temp, gatewayTempUnit));
    if (battery && battery !== 'None') {
      push(out, makeReading(`tf_batt${ch}`, batteryPercent(battery, false)));
    }
  }
}

/** WH41 PM2.5 (realtime + 24h avg + AQI indices) + bar battery. */
export function decodeChPm25(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const pm25 = str(item, 'pm25') ?? str(item, 'PM25');
    const pm25_24h = str(item, 'pm25_avg_24h') ?? str(item, 'pm25_24h');
    const realaqi = str(item, 'PM25_RealAQI');
    const aqi24h = str(item, 'PM25_24HAQI');
    const battery = str(item, 'battery');
    if (pm25 && pm25 !== 'None') push(out, makeReading(`pm25_ch${ch}`, pm25));
    if (pm25_24h && pm25_24h !== 'None') push(out, makeReading(`pm25_avg_24h_ch${ch}`, pm25_24h));
    if (realaqi && realaqi !== 'None') push(out, makeReading(`pm25_aqi_realtime_ch${ch}`, realaqi));
    if (aqi24h && aqi24h !== 'None') push(out, makeReading(`pm25_aqi_24h_ch${ch}`, aqi24h));
    if (battery && battery !== 'None') {
      push(out, makeReading(`pm25batt${ch}`, batteryPercent(battery, false)));
    }
  }
}

/** WH35 leaf wetness + bar battery. */
export function decodeChLeaf(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const humidity = stripPercent(str(item, 'humidity'));
    const battery = str(item, 'battery');
    if (humidity) push(out, makeReading(`leafwetness_ch${ch}`, humidity));
    if (battery && battery !== 'None') {
      push(out, makeReading(`leaf_batt${ch}`, batteryPercent(battery, false)));
    }
  }
}

/** WH55 leak: status normal -> "0", else "1"; bar battery. */
export function decodeChLeak(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const status = str(item, 'status');
    const battery = str(item, 'battery');
    if (status !== undefined && status !== '') {
      const leak = status.trim().toLowerCase() === 'normal' ? '0' : '1';
      push(out, makeReading(`leak_ch${ch}`, leak));
    }
    if (battery !== undefined && battery !== 'None') {
      push(out, makeReading(`leakbatt${ch}`, batteryPercent(battery, false)));
    }
  }
}

/** WH54 liquid-depth: air gap + depth + voltage + bar battery. */
export function decodeChLds(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  for (const item of items) {
    const ch = channelOf(item);
    if (ch === undefined) continue;
    const air = str(item, 'air');
    const depth = str(item, 'depth');
    const voltage = str(item, 'voltage');
    const battery = str(item, 'battery');
    if (air && air !== 'None') push(out, makeReading(`lds_air_ch${ch}`, air));
    if (depth && depth !== 'None') push(out, makeReading(`lds_depth_ch${ch}`, depth));
    if (voltage && voltage !== 'None') push(out, makeReading(`lds_voltage_ch${ch}`, voltage));
    if (battery !== undefined && battery !== 'None') {
      push(out, makeReading(`lds_batt${ch}`, batteryPercent(battery, false)));
    }
  }
}

// WH45/WH46 combo: (gateway field, live key) pairs that are simple numeric pass-throughs.
const CO2_FIELDS: ReadonlyArray<readonly [string[], string]> = [
  [['PM25', 'pm25'], 'pm25_co2'],
  [['PM25_24H', 'pm25_24h'], 'pm25_24h_co2'],
  [['PM10', 'pm10'], 'pm10_co2'],
  [['PM10_24H', 'pm10_24h'], 'pm10_24h_co2'],
  [['PM1', 'pm1'], 'pm1_co2'],
  [['PM1_24H', 'pm1_24h'], 'pm1_24h_co2'],
  [['PM4', 'pm4'], 'pm4_co2'],
  [['PM4_24H', 'pm4_24h'], 'pm4_24h_co2'],
  [['PM25_RealAQI'], 'pm25_realaqi_co2'],
  [['PM25_24HAQI'], 'pm25_24haqi_co2'],
  [['PM10_RealAQI'], 'pm10_realaqi_co2'],
  [['PM10_24HAQI'], 'pm10_24haqi_co2'],
  [['PM1_RealAQI'], 'pm1_realaqi_co2'],
  [['PM1_24HAQI'], 'pm1_24haqi_co2'],
  [['PM4_RealAQI'], 'pm4_realaqi_co2'],
  [['PM4_24HAQI'], 'pm4_24haqi_co2'],
  [['CO2', 'CO2_val'], 'co2'],
  [['CO2_24H', 'co2_24h_val'], 'co2_24h'],
];

function firstField(item: Item, fields: string[]): string | undefined {
  for (const f of fields) {
    const v = str(item, f);
    if (v && v !== 'None') return v;
  }
  return undefined;
}

/** WH45/WH46 CO2 combo (single, channel-less): temp(+unit), humidity, PM family, AQI, CO2, battery. */
export function decodeCo2(items: ReadonlyArray<Item>, out: LiveReading[]): void {
  const item = items[0];
  if (item === undefined) return;
  const temp = str(item, 'temp');
  const unit = str(item, 'unit') ?? 'C';
  if (temp) push(out, makeReading(unit === 'C' ? 'tf_co2c' : 'tf_co2', temp, unit));
  const humidity = stripPercent(str(item, 'humidity'));
  if (humidity) push(out, makeReading('humi_co2', humidity));
  for (const [fields, key] of CO2_FIELDS) {
    const v = firstField(item, fields);
    if (v !== undefined) push(out, makeReading(key, v));
  }
  const battery = str(item, 'battery');
  if (battery && battery !== 'None') {
    const pct = num(battery) !== undefined ? String(Math.min(num(battery)! * 20, 100)) : battery;
    push(out, makeReading('co2_batt', pct));
  }
}
