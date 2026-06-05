# nodewitt

Node.js/TypeScript client for Ecowitt weather stations — local poll + push, one unified sensor model.

> Work in progress. Event-driven library — not a UI.

## Install

```bash
npm install nodewitt
```

## Transports

Two transports are implemented: the local-poll client and the HTTP push listener (an internal
`node:http` server that receives the gateway's "Customized" `x-www-form-urlencoded` uploads and
decodes them into the same SI-normalized readings). The push listener is wired into the public
facade in the next phase.

## Acknowledgments

The local-poll layer ports [alexlenk/ecowitt_local](https://github.com/alexlenk/ecowitt_local) (MIT).
The push layer is an independent implementation of Ecowitt's documented push protocol, informed by
[garbled1/pyecowitt](https://github.com/garbled1/pyecowitt) and
[garbled1/homeassistant_ecowitt](https://github.com/garbled1/homeassistant_ecowitt) (Apache-2.0) as
protocol references. See `LICENSE`.

## License

MIT.
