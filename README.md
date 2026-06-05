# nodewitt

Node.js/TypeScript client for Ecowitt weather stations — local poll + push, one unified sensor model.

> Event-driven library — not a UI.

## Install

```bash
npm install @apocaliss92/nodewitt
```

## Transports

Two transports are implemented: the local-poll client and the HTTP push listener (an internal
`node:http` server that receives the gateway's "Customized" `x-www-form-urlencoded` uploads and
decodes them into the same SI-normalized readings). Both are exposed behind the single `Ecowitt`
facade, which converges them onto one unified `Sensor` model with a typed event stream.

## Usage

The `Ecowitt` facade is the only public entry point. Pick a transport with `Ecowitt.createLocal`
(poll the gateway over HTTP) or `Ecowitt.createListener` (receive the gateway's push uploads), then
drive it with the same lifecycle: `start()` / `stop()`, subscribe with `on(...)` / `off(...)` /
`once(...)`, and read a point-in-time snapshot with `getStation()` (or `getSensors()`).

> `stop()` is **terminal**: it tears down the transport and removes all listeners, and the instance
> cannot be restarted. Create a new `Ecowitt` via `createLocal` / `createListener` to resume.

### Local poll

```ts
import { Ecowitt } from '@apocaliss92/nodewitt';

const client = Ecowitt.createLocal({
  host: '192.168.20.181',
  // port: 80,                 // gateway HTTP port (default 80)
  // password: 'secret',       // newer firmware
  // pollIntervalMs: 60000,    // live-data poll interval (default 60000)
  // mappingIntervalMs: 600000 // sensor-map refresh interval (default 600000)
});

client.on('update', (sensors) => {
  for (const s of sensors) {
    console.log(s.id, s.quantity, s.value, s.unit, s.battery ?? '', s.batteryUnit ?? '');
  }
});
client.on('sensorChanged', (s) => console.log('changed', s.id, s.value));
client.on('snapshot', (snap) => console.log('sensors:', snap.sensors.length));
client.on('error', (err) => console.error('ecowitt error', err.message));

await client.start();
// ... later
console.log(client.getStation().sensors.length);
await client.stop();
```

### Push listener

```ts
import { Ecowitt } from '@apocaliss92/nodewitt';

const client = Ecowitt.createListener({ port: 4199 }); // port: 0 for an ephemeral port
client.on('update', (sensors) => console.log('push update', sensors.length));

await client.start();
console.log('listening on', client.getAddress()); // point the gateway "Customized" upload here
// ... later
await client.stop();
```

### Events

| event           | payload           | when                                                                         |
| --------------- | ----------------- | ---------------------------------------------------------------------------- |
| `update`        | `Sensor[]`        | the sensors whose value or battery changed on the latest ingest              |
| `sensorChanged` | `Sensor`          | one sensor changed (emitted once per changed sensor)                         |
| `snapshot`      | `StationSnapshot` | the full station snapshot after every ingest                                 |
| `error`         | `Error`           | a transport/decoder error (never thrown into the consumer)                   |
| `rawFrame`      | `RawFrame`        | a raw, undecoded transport frame (poll livedata / push form) for diagnostics |

### The unified `Sensor`

| field                       | meaning                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `id`                        | stable identity within the station                             |
| `hardwareId?`               | sensor hardware id (poll only)                                 |
| `model?` / `channel?`       | sensor model token / channel (1..8)                            |
| `quantity`                  | `temperature` \| `humidity` \| `pressure` \| `wind_speed` \| … |
| `value` / `unit` / `raw`    | SI value, SI unit, original string                             |
| `battery?` / `batteryUnit?` | battery level — `'%'` (decoded percent) or `'V'` (raw voltage) |
| `signal?`                   | signal strength (poll, when known)                             |
| `lastUpdated`               | epoch millis                                                   |

Both transports converge on this one model: poll keys sensors by hardware id (stable across battery
swaps); push keys by `PASSKEY` + channel. Values are SI internally with the raw string preserved.
Batteries are surfaced exactly as the transport produced them (percent or volts) — never re-decoded.

## Diagnostic dump

`createDumper` attaches a **read-only** diagnostic recorder to a live `Ecowitt` client. nodewitt
issues no commands — the dumper only _observes_ the event stream plus a sensor snapshot — so it can
never change the gateway. It records what the station exposes during operation (sensor models,
channels, measurement keys, battery encodings, and optionally raw frames) and exports an
**anonymized** `DeviceDump` JSON in the shared cross-library dump format.

```ts
import { Ecowitt, createDumper } from '@apocaliss92/nodewitt';

const client = Ecowitt.createLocal({ host: '192.168.20.181' });
const dumper = createDumper(client, { captureRawFrames: true });
await client.start();
dumper.start();
// ...let the station report for a while (one or more poll ticks)...
dumper.stop();
const json = dumper.exportJson(); // anonymized, share-safe JSON
await client.stop();
```

The output is **anonymized**: the gateway `mac` / `PASSKEY` / SSID / IP / host / latitude / longitude
and any value-borne secret are replaced with `[redacted]`. Raw frames are scrubbed both on capture and
on export, so a `PASSKEY` or `mac` carried in a poll/push frame never reaches the JSON.

### Sharing a dump to extend the sensor tables

Entries under `observations.properties` with a **non-empty `unmapped` array** name something nodewitt
does not yet recognize:

- `model:<img>` — a sensor model token (e.g. a brand-new `wh99`) absent from the protocol tables.
- `key:<rawKey>` — a measurement/push key (e.g. a new hex id or firmware field) that `classifyKey`
  cannot map.
- `battery:<rawKey>` — a battery key whose encoding none of the decoders can decode.

Attaching the anonymized JSON to a GitHub issue lets maintainers fold the new sensor type into
`protocol/sensor-models.ts` / `protocol/hex-ids.ts` / `protocol/battery.ts`.

> **Note:** `captureRawFrames` (off by default) is required to surface unknown raw measurement keys
> and undecodable batteries. The `Station` drops any reading it cannot classify, so those keys only
> appear in the raw poll/push frames — which the dumper captures (and redacts) only when this flag is
> on. The unmapped-_model_ signal works without it.

## Acknowledgments

The local-poll layer ports [alexlenk/ecowitt_local](https://github.com/alexlenk/ecowitt_local) (MIT).
The push layer is an independent implementation of Ecowitt's documented push protocol, informed by
[garbled1/pyecowitt](https://github.com/garbled1/pyecowitt) and
[garbled1/homeassistant_ecowitt](https://github.com/garbled1/homeassistant_ecowitt) (Apache-2.0) as
protocol references. See `LICENSE`.

## License

MIT.
