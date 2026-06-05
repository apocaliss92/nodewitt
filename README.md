# nodewitt

Node.js/TypeScript client for Ecowitt weather stations — local poll + push, one unified sensor model.

> Work in progress. Event-driven library — not a UI.

## Install

```bash
npm install nodewitt
```

## Acknowledgments

The local-poll layer ports [alexlenk/ecowitt_local](https://github.com/alexlenk/ecowitt_local) (MIT).
The push layer is an independent implementation of Ecowitt's documented push protocol, informed by
[garbled1/pyecowitt](https://github.com/garbled1/pyecowitt) and
[garbled1/homeassistant_ecowitt](https://github.com/garbled1/homeassistant_ecowitt) (Apache-2.0) as
protocol references. See `LICENSE`.

## License

MIT.
