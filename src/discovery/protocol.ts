/**
 * GW1000/GW2000-family UDP broadcast discovery protocol (the "CMD_BROADCAST" command).
 *
 * Ecowitt gateways answer a broadcast probe on UDP port 46000 with a single frame carrying their
 * MAC, (SoftAP) IP, binary-protocol TCP port and module SSID. The wire layout was verified against a
 * live GW1100A gateway:
 *
 * ```
 *   ff ff | 12 | 00 27 | bc ff 4d 1c c3 f6 | c0 a8 04 01 | af c8 | 17 | "GW1100A-WIFIC3F6 V2.4.5" | 6d
 *   FFFF   CMD   u16sz    MAC (6 bytes)       IP (4 bytes)  port    N    SSID (N bytes)              cksum
 * ```
 *
 * The payload IP field frequently carries the gateway's SoftAP address (`192.168.4.1`) rather than
 * its live LAN address, so callers MUST use the UDP sender address as the reachable host — the
 * parser here only decodes the frame body. This mirrors `@apocaliss92/nodegree`'s discovery, which
 * also keys the device IP off the responder's address.
 */

/** Discovery command byte — CMD_BROADCAST. */
export const CMD_BROADCAST = 0x12;

/** Default UDP port Ecowitt gateways listen on for the broadcast probe. */
export const DISCOVERY_PORT = 46000;

/** A single gateway decoded from a broadcast response frame. */
export interface DiscoveredGatewayFrame {
  /** Gateway MAC address, colon-separated lower-hex (`bc:ff:4d:1c:c3:f6`). */
  readonly mac: string;
  /** Module/AP name from the SSID field, e.g. `GW1100A-WIFIC3F6`. */
  readonly module: string;
  /** Model inferred from the SSID prefix before `-WIFI`, e.g. `GW1100A`. `undefined` when unparseable. */
  readonly model: string | undefined;
  /** Firmware string parsed from the SSID suffix, e.g. `V2.4.5`. `undefined` when absent. */
  readonly firmware: string | undefined;
  /** Binary-protocol TCP port reported in the payload (usually 45000). */
  readonly tcpPort: number;
}

/**
 * Build the broadcast probe packet: `FF FF <CMD> <SIZE> <CHECKSUM>`. `SIZE` counts the bytes from
 * `CMD` to the checksum inclusive (3 for the payload-less broadcast command); the checksum is the
 * low byte of the sum of every byte from `CMD` onward.
 */
export function buildScanPacket(): Buffer {
  const size = 0x03; // CMD(1) + SIZE(1) + CHECKSUM(1)
  const checksum = (CMD_BROADCAST + size) & 0xff;
  return Buffer.from([0xff, 0xff, CMD_BROADCAST, size, checksum]);
}

/** True when the trailing checksum byte matches `sum(buf[2 .. len-2]) & 0xff`. */
export function verifyChecksum(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  let sum = 0;
  for (let i = 2; i < buf.length - 1; i += 1) sum = (sum + (buf[i] ?? 0)) & 0xff;
  return sum === buf[buf.length - 1];
}

/**
 * Decode a broadcast response frame. Returns `null` for anything that is not a well-formed,
 * checksum-valid `CMD_BROADCAST` reply, so a stray UDP packet on the socket is ignored rather than
 * surfaced as a garbage candidate.
 */
export function parseBroadcastResponse(buf: Buffer): DiscoveredGatewayFrame | null {
  // header(2) + cmd(1) + size(2) + mac(6) + ip(4) + port(2) + ssidLen(1) = 18 minimum
  if (buf.length < 18) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xff || buf[2] !== CMD_BROADCAST) return null;
  if (!verifyChecksum(buf)) return null;

  const mac = macFromBytes(buf.subarray(5, 11));
  const tcpPort = buf.readUInt16BE(15);
  const ssidLen = buf[17] ?? 0;
  const ssidEnd = Math.min(18 + ssidLen, buf.length - 1);
  const ssid = buf.subarray(18, ssidEnd).toString('ascii').trim();
  const { module, model, firmware } = splitSsid(ssid);

  return { mac, module, model, firmware, tcpPort };
}

function macFromBytes(bytes: Buffer): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

interface SsidParts {
  readonly module: string;
  readonly model: string | undefined;
  readonly firmware: string | undefined;
}

/**
 * Split the SSID `GW1100A-WIFIC3F6 V2.4.5` into its module name (`GW1100A-WIFIC3F6`), the model
 * inferred from the prefix before `-WIFI` (`GW1100A`) and the firmware suffix (`V2.4.5`).
 */
function splitSsid(ssid: string): SsidParts {
  const spaceIdx = ssid.indexOf(' ');
  const module = spaceIdx >= 0 ? ssid.slice(0, spaceIdx) : ssid;
  const firmwareRaw = spaceIdx >= 0 ? ssid.slice(spaceIdx + 1).trim() : '';
  const wifiIdx = module.indexOf('-WIFI');
  const model = wifiIdx > 0 ? module.slice(0, wifiIdx) : undefined;
  return {
    module,
    model,
    firmware: firmwareRaw.length > 0 ? firmwareRaw : undefined,
  };
}
