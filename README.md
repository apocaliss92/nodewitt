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

| event           | payload           | when                                                            |
| --------------- | ----------------- | --------------------------------------------------------------- |
| `update`        | `Sensor[]`        | the sensors whose value or battery changed on the latest ingest |
| `sensorChanged` | `Sensor`          | one sensor changed (emitted once per changed sensor)            |
| `snapshot`      | `StationSnapshot` | the full station snapshot after every ingest                    |
| `error`         | `Error`           | a transport/decoder error (never thrown into the consumer)      |

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

## Acknowledgments

The local-poll layer ports [alexlenk/ecowitt_local](https://github.com/alexlenk/ecowitt_local) (MIT).
The push layer is an independent implementation of Ecowitt's documented push protocol, informed by
[garbled1/pyecowitt](https://github.com/garbled1/pyecowitt) and
[garbled1/homeassistant_ecowitt](https://github.com/garbled1/homeassistant_ecowitt) (Apache-2.0) as
protocol references. See `LICENSE`.

## License

MIT.
