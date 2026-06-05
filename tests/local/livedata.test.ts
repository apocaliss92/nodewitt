import { describe, it, expect } from 'vitest';
import { decodeLiveData, type LiveReading } from '../../src/local/livedata.js';

// A minimal mapper seam: live_key -> hardware_id (what SensorMapper.getHardwareId provides).
function mapper(map: Record<string, string>): { getHardwareId: (k: string) => string | undefined } {
  return { getHardwareId: (k) => map[k] };
}
function byKey(readings: LiveReading[], key: string): LiveReading | undefined {
  return readings.find((r) => r.key === key);
}

describe('decodeLiveData', () => {
  it('decodes common_list hex items and the WH26 battery embedded in 0x03', () => {
    const readings = decodeLiveData(
      {
        common_list: [
          { id: '0x02', val: '20.5' },
          { id: '0x03', val: '12.0', battery: '0' },
          { id: '0x07', val: '55%' },
        ],
      },
      mapper({ wh26batt: 'AABBCC' }),
    );
    expect(byKey(readings, '0x02')?.value).toBeCloseTo(20.5);
    expect(byKey(readings, '0x07')?.value).toBeCloseTo(55);
    // embedded WH26 battery: "0" -> 100%
    expect(byKey(readings, 'wh26batt')?.value).toBe(100);
  });

  it('decodes the decimal-id common_list Feels Like ("3") and VPD ("5") keys', () => {
    const readings = decodeLiveData(
      {
        common_list: [
          { id: '3', val: '17.3', unit: 'C' },
          { id: '5', val: '0.533 kPa' },
          { id: '0x03', val: '12.0' }, // regression: hex Dewpoint still decodes alongside "3"
        ],
      },
      mapper({}),
    );
    expect(byKey(readings, '3')?.value).toBeCloseTo(17.3);
    const vpd = byKey(readings, '5');
    expect(vpd?.value).toBeCloseTo(0.533);
    expect(vpd?.unit).toBe('kPa'); // kPa passes through, not force-converted
    // regression: hex 0x03 Dewpoint is a distinct reading, not shadowed by "3"
    expect(byKey(readings, '0x03')?.value).toBeCloseTo(12.0);
  });

  it('does NOT emit the WH26 battery from 0x03 when wh26batt is not mapped (donor guard)', () => {
    const readings = decodeLiveData(
      {
        common_list: [{ id: '0x03', val: '12.0', battery: '0' }],
      },
      mapper({}), // no wh26batt mapping
    );
    expect(byKey(readings, 'wh26batt')).toBeUndefined();
  });

  it('emits the WH26 battery from 0x03 when wh26batt IS mapped', () => {
    const readings = decodeLiveData(
      {
        common_list: [{ id: '0x03', val: '12.0', battery: '1' }],
      },
      mapper({ wh26batt: 'AABBCC' }),
    );
    // binary "1" -> 10%
    expect(byKey(readings, 'wh26batt')?.value).toBe(10);
  });

  it('forces the rain-array items onto the tipping-bucket hardware id and decodes 0x13 battery', () => {
    const readings = decodeLiveData(
      {
        rain: [
          { id: '0x0D', val: '0.00 mm' },
          { id: '0x13', val: '29.5 mm', battery: '0' },
        ],
      },
      mapper({ wh40batt: 'RAIN01' }),
    );
    const event = byKey(readings, '0x0D');
    expect(event?.forceHardwareId).toBe('RAIN01');
    expect(byKey(readings, 'wh40batt')?.value).toBe(100); // binary "0" -> 100%
  });

  it('forces piezoRain onto the piezo hardware id and decodes the WS90 battery+voltages on 0x13', () => {
    const readings = decodeLiveData(
      {
        piezoRain: [
          { id: '0x0D', val: '0.00 mm' },
          { id: '0x13', val: '258 mm', battery: '3', voltage: '2.62', ws90cap_volt: '5.3' },
        ],
      },
      mapper({ ws90batt: 'PIEZO9' }),
    );
    expect(byKey(readings, '0x0D')?.forceHardwareId).toBe('PIEZO9');
    expect(byKey(readings, 'ws90batt')?.value).toBe(60); // "3" * 20
    expect(byKey(readings, 'ws90_voltage')?.value).toBeCloseTo(2.62);
    expect(byKey(readings, 'ws90cap_volt')?.value).toBeCloseTo(5.3);
  });

  it('decodes ch_aisle (WH31) temp/humidity/battery with a channel', () => {
    const readings = decodeLiveData(
      { ch_aisle: [{ channel: '1', temp: '21.0', humidity: '48%', battery: '0', unit: 'C' }] },
      mapper({}),
    );
    expect(byKey(readings, 'temp1f')?.value).toBeCloseTo(21.0);
    expect(byKey(readings, 'humidity1')?.value).toBeCloseTo(48);
    expect(byKey(readings, 'batt1')?.value).toBe(100); // binary "0"
  });

  it('rain 0x13 with a bar battery (>1) uses *20 and prefers the wh69 key when registered', () => {
    const readings = decodeLiveData(
      { rain: [{ id: '0x13', val: '12.0 mm', battery: '3' }] },
      mapper({ wh69batt: 'BUCKET69' }),
    );
    // value > 1 -> bar scale 3*20 = 60, key resolves to wh69batt
    expect(byKey(readings, 'wh69batt')?.value).toBe(60);
    expect(byKey(readings, '0x13')?.forceHardwareId).toBe('BUCKET69');
  });

  it('piezo WS85 wins over WS90/WH90 for the force id and battery key set', () => {
    const readings = decodeLiveData(
      {
        piezoRain: [
          { id: '0x13', val: '10 mm', battery: '4', voltage: '2.7', ws85cap_volt: '5.1' },
        ],
      },
      mapper({ ws85batt: 'PIEZO85', ws90batt: 'IGNORED' }),
    );
    expect(byKey(readings, '0x13')?.forceHardwareId).toBe('PIEZO85');
    expect(byKey(readings, 'ws85batt')?.value).toBe(80); // 4*20
    expect(byKey(readings, 'ws85_voltage')?.value).toBeCloseTo(2.7);
    expect(byKey(readings, 'ws85cap_volt')?.value).toBeCloseTo(5.1);
  });

  it('piezo falls back to the wh90 key set when only the field name uses ws90cap_volt', () => {
    const readings = decodeLiveData(
      { piezoRain: [{ id: '0x13', val: '10 mm', battery: '5', ws90cap_volt: '5.4' }] },
      mapper({ wh90batt: 'PIEZO90' }),
    );
    expect(byKey(readings, 'wh90batt')?.value).toBe(100); // 5*20 clamped at 100
    // cap field is ws90cap_volt but the emitted key is wh90cap_volt
    expect(byKey(readings, 'wh90cap_volt')?.value).toBeCloseTo(5.4);
  });

  it('decodes lightning count + distance + battery, skipping the non-numeric date', () => {
    const readings = decodeLiveData(
      {
        lightning: [{ count: '7', date: '2026-06-05 12:00', distance: '5 km', battery: '4' }],
      },
      mapper({}),
    );
    expect(byKey(readings, 'lightning_num')?.value).toBe(7);
    expect(byKey(readings, 'lightning')?.value).toBeCloseTo(5);
    expect(byKey(readings, 'wh57batt')?.value).toBe(80); // 4*20
    expect(byKey(readings, 'lightning_time')).toBeUndefined(); // date is non-numeric -> skipped
  });

  it('decodes wh25 indoor station temp/humidity/pressures', () => {
    const readings = decodeLiveData(
      {
        wh25: [{ intemp: '20.0', unit: 'C', inhumi: '50%', abs: '1013.0 hPa', rel: '1015.0 hPa' }],
      },
      mapper({}),
    );
    expect(byKey(readings, 'tempinf')?.value).toBeCloseTo(20.0);
    expect(byKey(readings, 'humidityin')?.value).toBeCloseTo(50);
    expect(byKey(readings, 'baromabsin')?.value).toBeCloseTo(1013.0);
    expect(byKey(readings, 'baromrelin')?.value).toBeCloseTo(1015.0);
  });

  it('decodes ch_soil (WH51) moisture + binary battery', () => {
    const readings = decodeLiveData(
      { ch_soil: [{ channel: '2', humidity: '33%', battery: '1' }] },
      mapper({}),
    );
    expect(byKey(readings, 'soilmoisture2')?.value).toBeCloseTo(33);
    expect(byKey(readings, 'soilbatt2')?.value).toBe(10); // binary "1" -> low
  });

  it('decodes ch_ec (WH52) moisture/temp/ec + bar battery', () => {
    const readings = decodeLiveData(
      {
        ch_ec: [
          { channel: '1', humidity: '40%', temp: '18.0', unit: 'C', ec: '250', battery: '3' },
        ],
      },
      mapper({}),
    );
    expect(byKey(readings, 'soilmoisture1')?.value).toBeCloseTo(40);
    expect(byKey(readings, 'soiltemp1')?.value).toBeCloseTo(18.0);
    expect(byKey(readings, 'soilec1')?.value).toBeCloseTo(250);
    expect(byKey(readings, 'soilbatt1')?.value).toBe(60); // 3*20
  });

  it('decodes ch_temp (WH34) temp + bar battery with the gateway unit', () => {
    const readings = decodeLiveData(
      { ch_temp: [{ channel: '1', temp: '15.0', battery: '2' }] },
      mapper({}),
      {},
      'C',
    );
    expect(byKey(readings, 'tf_ch1')?.value).toBeCloseTo(15.0);
    expect(byKey(readings, 'tf_batt1')?.value).toBe(40); // 2*20
  });

  it('decodes ch_pm25 (WH41) realtime/24h/AQI + bar battery', () => {
    const readings = decodeLiveData(
      {
        ch_pm25: [
          {
            channel: '1',
            pm25: '12',
            pm25_avg_24h: '15',
            PM25_RealAQI: '50',
            PM25_24HAQI: '60',
            battery: '5',
          },
        ],
      },
      mapper({}),
    );
    expect(byKey(readings, 'pm25_ch1')?.value).toBe(12);
    expect(byKey(readings, 'pm25_avg_24h_ch1')?.value).toBe(15);
    expect(byKey(readings, 'pm25_aqi_realtime_ch1')?.value).toBe(50);
    expect(byKey(readings, 'pm25_aqi_24h_ch1')?.value).toBe(60);
    expect(byKey(readings, 'pm25batt1')?.value).toBe(100); // 5*20 clamp
  });

  it('decodes ch_leaf (WH35) wetness + bar battery', () => {
    const readings = decodeLiveData(
      { ch_leaf: [{ channel: '1', humidity: '22%', battery: '3' }] },
      mapper({}),
    );
    expect(byKey(readings, 'leafwetness_ch1')?.value).toBeCloseTo(22);
    expect(byKey(readings, 'leaf_batt1')?.value).toBe(60);
  });

  it('decodes ch_leak (WH55): status normal -> 0, leak -> 1, bar battery', () => {
    const dry = decodeLiveData(
      { ch_leak: [{ channel: '1', status: 'Normal', battery: '4' }] },
      mapper({}),
    );
    expect(byKey(dry, 'leak_ch1')?.value).toBe(0);
    expect(byKey(dry, 'leakbatt1')?.value).toBe(80);

    const wet = decodeLiveData({ ch_leak: [{ channel: '2', status: 'Leakage' }] }, mapper({}));
    expect(byKey(wet, 'leak_ch2')?.value).toBe(1);
  });

  it('decodes ch_lds (WH54) air/depth/voltage + bar battery', () => {
    const readings = decodeLiveData(
      { ch_lds: [{ channel: '1', air: '100', depth: '200', voltage: '3.1', battery: '2' }] },
      mapper({}),
    );
    expect(byKey(readings, 'lds_air_ch1')?.value).toBe(100);
    expect(byKey(readings, 'lds_depth_ch1')?.value).toBe(200);
    expect(byKey(readings, 'lds_voltage_ch1')?.value).toBeCloseTo(3.1);
    expect(byKey(readings, 'lds_batt1')?.value).toBe(40);
  });

  it('decodes co2 (WH45) combo with min-clamped battery', () => {
    const readings = decodeLiveData(
      {
        co2: [
          {
            temp: '22.0',
            unit: 'C',
            humidity: '45%',
            PM25: '8',
            CO2: '650',
            PM25_RealAQI: '33',
            battery: '6',
          },
        ],
      },
      mapper({}),
    );
    expect(byKey(readings, 'tf_co2c')?.value).toBeCloseTo(22.0);
    expect(byKey(readings, 'humi_co2')?.value).toBeCloseTo(45);
    expect(byKey(readings, 'pm25_co2')?.value).toBe(8);
    expect(byKey(readings, 'co2')?.value).toBe(650);
    expect(byKey(readings, 'pm25_realaqi_co2')?.value).toBe(33);
    expect(byKey(readings, 'co2_batt')?.value).toBe(100); // min(6*20,100)
  });

  it('decodes co2 (WH45) with a non-numeric battery via the raw fallback (no battery reading)', () => {
    const readings = decodeLiveData(
      {
        co2: [
          {
            temp: '20.0',
            unit: 'F',
            CO2: '500',
            battery: 'low',
          },
        ],
      },
      mapper({}),
    );
    // unit 'F' -> the non-c temp key, value converted to °C
    expect(byKey(readings, 'tf_co2')?.unit).toBe('°C');
    expect(byKey(readings, 'co2')?.value).toBe(500);
    // a non-numeric battery falls through to the raw value, which is not numeric
    // and so yields no co2_batt reading (makeReading skips it)
    expect(byKey(readings, 'co2_batt')).toBeUndefined();
  });

  it('applies the optional soilad + lds enrichment from extra', () => {
    const readings = decodeLiveData({ common_list: [{ id: '0x02', val: '20.0' }] }, mapper({}), {
      soilCalibration: [{ ch: '1', nowAd: '123' }],
      ldsConfig: [{ ch: '1', level: '50', total_heat: '7' }],
    });
    expect(byKey(readings, 'soilad1')?.value).toBe(123);
    expect(byKey(readings, 'lds_level_ch1')?.value).toBe(50);
    expect(byKey(readings, 'lds_total_heat_ch1')?.value).toBe(7);
  });

  it('rain without a registered bucket id still decodes items (no forceHardwareId)', () => {
    const readings = decodeLiveData({ rain: [{ id: '0x0D', val: '1.5 mm' }] }, mapper({}));
    const r = byKey(readings, '0x0D');
    expect(r?.value).toBeCloseTo(1.5);
    expect(r?.forceHardwareId).toBeUndefined();
  });
});
