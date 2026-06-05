// Public API surface of nodewitt.
// Only the facade + its public types are exported here; protocol, transport and
// model internals stay private to keep the published surface small and stable.

export { LIBRARY_NAME } from './support/version.js';

export { Ecowitt } from './api/ecowitt.js';

// Public types only (type-only, so they are not runtime keys).
export type { Sensor, BatteryUnit } from './model/sensor.js';
export type { StationSnapshot } from './model/station.js';
export type { Quantity } from './protocol/hex-ids.js';
export type { LocalOptions, ListenerOptions, EcowittOptions, EcowittEvents } from './api/types.js';
