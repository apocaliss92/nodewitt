/**
 * Sensor model/img string -> the ordered set of live-data keys that model owns.
 *
 * Ported from the MIT `ecowitt_local` `_generate_live_data_keys`. Channelized models
 * interpolate the channel number; station/array models return a fixed key list (hex IDs
 * decoded via the common_list block plus battery/voltage keys). Matching is
 * case-insensitive on the model token. Donor alias tokens (temp_hum, soil, lightning,
 * rain, ...) are accepted alongside the WH/WS/WN model codes. WN34/WN35 alias the donor's
 * WH34/WH35 (same live-data key shape).
 */

const norm = (model: string): string => model.trim().toLowerCase();

// Per-shape channel builders, declared once and aliased into the lookup record below.
// Referencing the named builders (rather than self-indexing the record) keeps the
// aliases type-safe under `noUncheckedIndexedAccess` without any cast.
const soilKeys = (ch: number): string[] => [
  `soilmoisture${ch}`,
  `soilad${ch}`,
  `soiltemp${ch}`,
  `soilec${ch}`,
  `soilbatt${ch}`,
];
const tempHumKeys = (ch: number): string[] => [`temp${ch}f`, `humidity${ch}`, `batt${ch}`];
const pm25Keys = (ch: number): string[] => [
  `pm25_ch${ch}`,
  `pm25_avg_24h_ch${ch}`,
  `pm25_aqi_realtime_ch${ch}`,
  `pm25_aqi_24h_ch${ch}`,
  `pm25batt${ch}`,
];
const leakKeys = (ch: number): string[] => [`leak_ch${ch}`, `leakbatt${ch}`];
const tempOnlyKeys = (ch: number): string[] => [`tf_ch${ch}`, `tf_ch${ch}c`, `tf_batt${ch}`];
const leafKeys = (ch: number): string[] => [`leafwetness_ch${ch}`, `leaf_batt${ch}`];
const ldsKeys = (ch: number): string[] => [
  `lds_air_ch${ch}`,
  `lds_depth_ch${ch}`,
  `lds_voltage_ch${ch}`,
  `lds_batt${ch}`,
  `lds_level_ch${ch}`,
  `lds_total_heat_ch${ch}`,
];

const channelized: Record<string, (ch: number) => string[]> = {
  // WH52 soil + EC (and WH51 soil moisture share the same key shape)
  wh52: soilKeys,
  soil_ec: soilKeys,
  wh51: soilKeys,
  soil: soilKeys,
  // WH31 temp/hum
  wh31: tempHumKeys,
  temp_hum: tempHumKeys,
  // WH41 PM2.5
  wh41: pm25Keys,
  pm25: pm25Keys,
  // WH55 leak
  wh55: leakKeys,
  leak: leakKeys,
  // WH34 / WN34 temp-only
  wh34: tempOnlyKeys,
  wn34: tempOnlyKeys,
  temp_only: tempOnlyKeys,
  // WH35 / WN35 leaf wetness
  wh35: leafKeys,
  wn35: leafKeys,
  leaf_wetness: leafKeys,
  // WH54 liquid depth sensor
  wh54: ldsKeys,
  lds: ldsKeys,
};

// Shared array key sets (declared once, reused by aliases).
const ARRAY_7IN1: string[] = [
  '0x02',
  '0x03',
  '0x04',
  '0x05',
  '0x07',
  '0x0B',
  '0x0C',
  '0x19',
  '0x0A',
  '0x6D',
  '0x15',
  '0x16',
  '0x17',
  '0x0D',
  '0x0E',
  '0x7C',
  '0x10',
  '0x11',
  '0x12',
  '0x13',
  '0x14',
  '3',
  '5',
];

// WS85 wind & rain key set (wind via common_list, rain + battery via piezoRain) — shared
// by the donor's wh85/"wind & rain" alias and the gateway's img="ws85" token.
const WS85_KEYS: string[] = [
  '0x0B',
  '0x0C',
  '0x19',
  '0x0A',
  '0x6D',
  '0x0D',
  '0x0E',
  '0x7C',
  '0x10',
  '0x11',
  '0x12',
  '0x13',
  '0x14',
  'ws85batt',
  'ws85_voltage',
  'ws85cap_volt',
];

// WH45/WH46 combo (CO2 + PM) key set — shared by all four donor aliases.
const COMBO_KEYS: string[] = [
  'tf_co2',
  'tf_co2c',
  'humi_co2',
  'pm25_co2',
  'pm25_24h_co2',
  'pm25_realaqi_co2',
  'pm25_24haqi_co2',
  'pm10_co2',
  'pm10_24h_co2',
  'pm10_realaqi_co2',
  'pm10_24haqi_co2',
  'pm1_co2',
  'pm1_24h_co2',
  'pm1_realaqi_co2',
  'pm1_24haqi_co2',
  'pm4_co2',
  'pm4_24h_co2',
  'pm4_realaqi_co2',
  'pm4_24haqi_co2',
  'co2',
  'co2_24h',
  'co2_batt',
];

const fixed: Record<string, string[]> = {
  // WH57 lightning
  wh57: ['lightning_num', 'lightning_time', 'lightning', 'lightning_mi', 'wh57batt'],
  lightning: ['lightning_num', 'lightning_time', 'lightning', 'lightning_mi', 'wh57batt'],
  // WH40 rain (hex ids arrive via the rain array)
  wh40: ['0x0D', '0x0E', '0x7C', '0x10', '0x11', '0x12', '0x13', 'wh40batt'],
  rain: ['0x0D', '0x0E', '0x7C', '0x10', '0x11', '0x12', '0x13', 'wh40batt'],
  // WH68 wind/solar station (imperial wunderground keys)
  wh68: [
    'tempf',
    'humidity',
    'windspeedmph',
    'windspdmph_avg10m',
    'windgustmph',
    'maxdailygust',
    'winddir',
    'winddir_avg10m',
    'baromrelin',
    'baromabsin',
    'solarradiation',
    'uv',
    'wh68batt',
  ],
  weather_station: [
    'tempf',
    'humidity',
    'windspeedmph',
    'windspdmph_avg10m',
    'windgustmph',
    'maxdailygust',
    'winddir',
    'winddir_avg10m',
    'baromrelin',
    'baromabsin',
    'solarradiation',
    'uv',
    'wh68batt',
  ],
  // WH69 / WH65 7-in-1 outdoor array
  wh69: [...ARRAY_7IN1, 'wh69batt'],
  wh65: [...ARRAY_7IN1, 'wh69batt'],
  weather_station_wh69: [...ARRAY_7IN1, 'wh69batt'],
  // WS90 array + voltage + cap voltage
  ws90: [...ARRAY_7IN1, 'ws90batt', 'ws90_voltage', 'ws90cap_volt'],
  weather_station_ws90: [...ARRAY_7IN1, 'ws90batt', 'ws90_voltage', 'ws90cap_volt'],
  // WH80 / WS80 wind/solar station (no rain hex ids)
  wh80: [
    '0x02',
    '0x03',
    '0x04',
    '0x05',
    '0x07',
    '0x0B',
    '0x0C',
    '0x19',
    '0x0A',
    '0x6D',
    '0x15',
    '0x16',
    '0x17',
    '3',
    '5',
    'wh80batt',
  ],
  ws80: [
    '0x02',
    '0x03',
    '0x04',
    '0x05',
    '0x07',
    '0x0B',
    '0x0C',
    '0x19',
    '0x0A',
    '0x6D',
    '0x15',
    '0x16',
    '0x17',
    '3',
    '5',
    'wh80batt',
  ],
  // WH90 array + voltage + cap voltage
  wh90: [...ARRAY_7IN1, 'wh90batt', 'wh90_voltage', 'wh90cap_volt'],
  weather_station_wh90: [...ARRAY_7IN1, 'wh90batt', 'wh90_voltage', 'wh90cap_volt'],
  // WH77 multi-sensor station (subset of hex ids, no UV irradiance/dewpoint extras)
  wh77: [
    '0x02',
    '0x03',
    '0x07',
    '0x0B',
    '0x0C',
    '0x19',
    '0x0A',
    '0x6D',
    '0x15',
    '0x17',
    '0x0D',
    '0x0E',
    '0x7C',
    '0x10',
    '0x11',
    '0x12',
    '0x13',
    'wh77batt',
  ],
  weather_station_wh77: [
    '0x02',
    '0x03',
    '0x07',
    '0x0B',
    '0x0C',
    '0x19',
    '0x0A',
    '0x6D',
    '0x15',
    '0x17',
    '0x0D',
    '0x0E',
    '0x7C',
    '0x10',
    '0x11',
    '0x12',
    '0x13',
    'wh77batt',
  ],
  // WH25 indoor station
  wh25: [
    'tempinf',
    'humidityin',
    'baromrelin',
    'baromabsin',
    '0x01',
    '0x06',
    '0x08',
    '0x09',
    'wh25batt',
  ],
  indoor_station: [
    'tempinf',
    'humidityin',
    'baromrelin',
    'baromabsin',
    '0x01',
    '0x06',
    '0x08',
    '0x09',
    'wh25batt',
  ],
  // WH26 / WN32 outdoor temp/hum
  wh26: ['0x02', '0x07', '0x03', 'wh26batt'],
  wn32: ['0x02', '0x07', '0x03', 'wh26batt'],
  outdoor_temp_hum: ['0x02', '0x07', '0x03', 'wh26batt'],
  // WN38 black globe thermometer
  wn38: ['0xA1', '0xA2', 'wn38batt'],
  bgt: ['0xA1', '0xA2', 'wn38batt'],
  // WS85 wind & rain. The gateway reports this sensor as img="ws85"; the donor matches the
  // same key set via `("wh85", "wind & rain")`, so both tokens alias the one WS85 key shape.
  wh85: WS85_KEYS,
  ws85: WS85_KEYS,
  // WH45 / WH46 combo CO2 + PM
  wh45: [...COMBO_KEYS],
  wh46: [...COMBO_KEYS],
  combo: [...COMBO_KEYS],
  co2_pm: [...COMBO_KEYS],
};

/**
 * Self-describing logical grouping of a sensor, derived purely from its `model` token.
 *
 *  - `gateway`         — the gateway/console itself and its indoor-firmware readings
 *                        (WH25 indoor station, or any reading with no resolvable model).
 *  - `weather-station` — the all-in-one outdoor array / wind-solar console sensors
 *                        (WH69/WH65/WS90/WH80/WS80/WH90/WH77/WH85/WS85/WH68).
 *  - `channel-sensor`  — the multi-channel add-on sensors that carry a `CH(n)` channel
 *                        (WH31/WH41/WH52/WH51/WH55/WH34/WN34/WH35/WN35/WH54).
 *  - `external`        — standalone single-purpose sensors that are neither the console
 *                        nor a CH-indexed add-on (WH57 lightning, WH40 rain, WH45/WH46 combo).
 *
 * This is the single source of truth a consumer uses to split one gateway into logical
 * devices. It is intentionally `model`-only (channel is layered on by the consumer when it
 * wants to further split a channel-sensor, e.g. CH1 vs the rest).
 */
export type SensorCategory = 'gateway' | 'weather-station' | 'channel-sensor' | 'external';

// Model tokens (and donor aliases) per category. The WH/WS/WN codes plus the donor alias
// tokens used by `channelized`/`fixed` above are both classified so a sensor resolves the
// same whether it was matched by its hardware `img` code or a donor alias.
const WEATHER_STATION_MODELS: ReadonlySet<string> = new Set([
  'wh69',
  'wh65',
  'ws90',
  'wh80',
  'ws80',
  'wh90',
  'wh77',
  'wh85',
  'ws85',
  'wh68',
  // donor aliases that resolve the same fixed key sets
  'weather_station',
  'weather_station_wh69',
  'weather_station_ws90',
  'weather_station_wh90',
  'weather_station_wh77',
]);

const CHANNEL_SENSOR_MODELS: ReadonlySet<string> = new Set([
  'wh31',
  'wh41',
  'wh52',
  'wh51',
  'wh55',
  'wh34',
  'wn34',
  'wh35',
  'wn35',
  'wh54',
  // donor aliases
  'temp_hum',
  'pm25',
  'soil',
  'soil_ec',
  'leak',
  'temp_only',
  'leaf_wetness',
  'lds',
]);

const EXTERNAL_MODELS: ReadonlySet<string> = new Set([
  'wh57',
  'wh40',
  'wh45',
  'wh46',
  // donor aliases
  'lightning',
  'rain',
  'combo',
  'co2_pm',
]);

const GATEWAY_MODELS: ReadonlySet<string> = new Set([
  'wh25',
  'indoor_station',
  // outdoor temp/hum + black-globe sit on the gateway/console firmware block
  'wh26',
  'wn32',
  'outdoor_temp_hum',
  'wn38',
  'bgt',
]);

/**
 * Classify a sensor into one of the four self-describing categories from its `model` token.
 *
 * An empty / unknown model resolves to `gateway`: gateway-firmware indoor readings (indoor
 * temp/humidity/pressure emitted via common_list) carry no per-sensor model, and the safe
 * default for anything otherwise unattributed is the console itself. Matching is
 * case-insensitive, mirroring `liveDataKeysForModel`.
 */
export function categoryForModel(model: string | undefined): SensorCategory {
  const key = norm(model ?? '');
  if (key === '') return 'gateway';
  if (WEATHER_STATION_MODELS.has(key)) return 'weather-station';
  if (CHANNEL_SENSOR_MODELS.has(key)) return 'channel-sensor';
  if (EXTERNAL_MODELS.has(key)) return 'external';
  if (GATEWAY_MODELS.has(key)) return 'gateway';
  // Unknown but non-empty model: treat as gateway-owned so it is never silently dropped.
  return 'gateway';
}

/**
 * Live-data keys a sensor model owns. Returns a fresh array (never the internal one).
 * Channelized models require a positive integer channel; without one they return [].
 * Unknown models return [].
 */
export function liveDataKeysForModel(model: string, channel?: number): string[] {
  const key = norm(model);

  const channelBuilder = Object.prototype.hasOwnProperty.call(channelized, key)
    ? channelized[key]
    : undefined;
  if (channelBuilder) {
    if (channel === undefined || !Number.isInteger(channel) || channel <= 0) {
      return [];
    }
    return channelBuilder(channel);
  }

  const fixedKeys = Object.prototype.hasOwnProperty.call(fixed, key) ? fixed[key] : undefined;
  return fixedKeys ? [...fixedKeys] : [];
}
