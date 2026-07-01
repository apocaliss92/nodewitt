/**
 * Ecowitt common_list hex-ID measurement table.
 *
 * Ported from the MIT `ecowitt_local` SENSOR_TYPES hex-ID block. Each id maps to a
 * human-readable name, a normalized physical quantity, and the unit the gateway emits
 * the value in by default (already SI where the gateway exposes SI). 0x0F (rain-gain
 * calibration) is intentionally excluded: it is a configuration value, not a measurement.
 */

/** Normalized physical quantity for a measurement. */
export type Quantity =
  | 'temperature'
  | 'humidity'
  | 'pressure'
  | 'wind_speed'
  | 'wind_direction'
  | 'irradiance'
  | 'uv'
  | 'precipitation'
  | 'precipitation_rate'
  | 'lightning_distance'
  | 'lightning_count'
  | 'vpd';

export interface HexIdInfo {
  readonly name: string;
  readonly quantity: Quantity;
  readonly defaultUnit: string;
}

const HEX_ID_TABLE = {
  // Indoor (emitted via common_list by some firmware)
  '0x01': { name: 'Indoor Temperature', quantity: 'temperature', defaultUnit: '°C' },
  '0x06': { name: 'Indoor Humidity', quantity: 'humidity', defaultUnit: '%' },
  '0x08': { name: 'Absolute Pressure', quantity: 'pressure', defaultUnit: 'hPa' },
  '0x09': { name: 'Relative Pressure', quantity: 'pressure', defaultUnit: 'hPa' },
  // Outdoor / weather-station
  '0x02': { name: 'Outdoor Temperature', quantity: 'temperature', defaultUnit: '°C' },
  '0x03': { name: 'Dewpoint Temperature', quantity: 'temperature', defaultUnit: '°C' },
  '0x04': { name: 'Wind Chill', quantity: 'temperature', defaultUnit: '°C' },
  '0x05': { name: 'Heat Index', quantity: 'temperature', defaultUnit: '°C' },
  '0x07': { name: 'Outdoor Humidity', quantity: 'humidity', defaultUnit: '%' },
  // Decimal-string ids (WH69 7-in-1): emitted alongside the hex ids; distinct from 0x03/0x05.
  '3': { name: 'Feels Like', quantity: 'temperature', defaultUnit: '°C' },
  '5': { name: 'VPD', quantity: 'vpd', defaultUnit: 'kPa' },
  '0x0B': { name: 'Wind Speed', quantity: 'wind_speed', defaultUnit: 'm/s' },
  '0x0C': { name: 'Wind Gust', quantity: 'wind_speed', defaultUnit: 'm/s' },
  '0x19': { name: 'Max Daily Gust', quantity: 'wind_speed', defaultUnit: 'm/s' },
  '0x0A': { name: 'Wind Direction', quantity: 'wind_direction', defaultUnit: '°' },
  '0x6D': { name: 'Wind Direction Avg', quantity: 'wind_direction', defaultUnit: '°' },
  '0x15': { name: 'Solar Radiation', quantity: 'irradiance', defaultUnit: 'W/m²' },
  '0x16': { name: 'UV Radiation', quantity: 'irradiance', defaultUnit: 'µW/m²' },
  '0x17': { name: 'UV Index', quantity: 'uv', defaultUnit: 'UV Index' },
  // Rain family (mm; rate in mm/Hr)
  '0x0D': { name: 'Rain Event', quantity: 'precipitation', defaultUnit: 'mm' },
  '0x0E': { name: 'Rain Rate', quantity: 'precipitation_rate', defaultUnit: 'mm/Hr' },
  '0x7C': { name: '24-Hour Rain', quantity: 'precipitation', defaultUnit: 'mm' },
  '0x10': { name: 'Daily Rain', quantity: 'precipitation', defaultUnit: 'mm' },
  '0x11': { name: 'Weekly Rain', quantity: 'precipitation', defaultUnit: 'mm' },
  '0x12': { name: 'Monthly Rain', quantity: 'precipitation', defaultUnit: 'mm' },
  '0x13': { name: 'Yearly Rain', quantity: 'precipitation', defaultUnit: 'mm' },
  '0x14': { name: 'Total Rain', quantity: 'precipitation', defaultUnit: 'mm' },
  // WN38 Black Globe Thermometer
  '0xA1': { name: 'Black Globe Temperature', quantity: 'temperature', defaultUnit: '°C' },
  '0xA2': { name: 'WBGT', quantity: 'temperature', defaultUnit: '°C' },
  // TODO(8E): hex id 0x8E is emitted by some gateways (~25× unmapped `8E:*` sub-sensors seen
  // live) but its measurement name/quantity/unit are unknown. This is the place to add it —
  // a single `'0x8E': { name, quantity, defaultUnit }` entry — but it is BLOCKED on a real
  // `/get_livedata_info` frame dump from the device so the mapping is verified, not guessed.
  // Do NOT add a speculative entry; an unknown id is safely classified `unknown` and ignored.
} satisfies Record<string, HexIdInfo>;

/** The full hex-ID table, frozen and read-only. */
export const HEX_IDS: Readonly<Record<string, HexIdInfo>> = Object.freeze(HEX_ID_TABLE);

/** Look up a measurement by its hex id (e.g. `"0x02"`). Returns `undefined` if unknown. */
export function lookupHexId(id: string): HexIdInfo | undefined {
  return Object.prototype.hasOwnProperty.call(HEX_IDS, id) ? HEX_IDS[id] : undefined;
}
