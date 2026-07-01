import { buildScanPacket, DISCOVERY_PORT, parseBroadcastResponse } from './protocol.js';
import type { UdpSocketLike } from './socket.js';

/** A gateway found on the network by {@link discoverGateways}. */
export interface DiscoveredGateway {
  /**
   * LAN IP the gateway responded FROM — authoritative and reachable. The frame's own IP field can
   * carry the stale SoftAP address (`192.168.4.1`), so the responder address is used instead.
   */
  readonly ip: string;
  /** Gateway MAC address, colon-separated lower-hex. */
  readonly mac: string;
  /** Display name — the module SSID (e.g. `GW1100A-WIFIC3F6`), or the MAC when the SSID is blank. */
  readonly name: string;
  /** Model inferred from the SSID prefix (e.g. `GW1100A`), when parseable. */
  readonly model?: string;
  /** Firmware string parsed from the SSID (e.g. `V2.4.5`), when present. */
  readonly firmware?: string;
}

/** Options for a discovery sweep. */
export interface DiscoverOptions {
  /**
   * Broadcast address to sweep. Defaults to `255.255.255.255` (the addon node's local subnet). Pass
   * a directed broadcast (e.g. `192.168.20.255`) to reach a gateway on another subnet.
   */
  readonly broadcastAddr?: string;
  /** UDP port to probe. Defaults to {@link DISCOVERY_PORT} (46000). */
  readonly port?: number;
  /** How long to collect responses before resolving. Defaults to 3000ms. */
  readonly timeoutMs?: number;
}

/**
 * Broadcast a `CMD_BROADCAST` probe and collect every gateway that answers within the timeout,
 * deduped by MAC. Mirrors `@apocaliss92/nodegree`'s `discover()`: the caller owns the socket
 * lifecycle (so a real scan closes it in a `finally`), and the device IP is taken from the
 * responder address, not the frame body.
 */
export function discoverGateways(
  socket: UdpSocketLike,
  opts?: DiscoverOptions,
): Promise<DiscoveredGateway[]> {
  const port = opts?.port ?? DISCOVERY_PORT;
  const broadcastAddr = opts?.broadcastAddr ?? '255.255.255.255';
  const timeoutMs = opts?.timeoutMs ?? 3000;
  const byMac = new Map<string, DiscoveredGateway>();

  socket.onMessage((m) => {
    const frame = parseBroadcastResponse(m.data);
    if (frame === null) return;
    byMac.set(frame.mac, {
      ip: m.address,
      mac: frame.mac,
      name: frame.module.length > 0 ? frame.module : frame.mac,
      ...(frame.model !== undefined ? { model: frame.model } : {}),
      ...(frame.firmware !== undefined ? { firmware: frame.firmware } : {}),
    });
  });

  socket.setBroadcast(true);
  const scan = buildScanPacket();
  return new Promise((resolve) => {
    void socket.send(scan, port, broadcastAddr);
    setTimeout(() => resolve([...byMac.values()]), timeoutMs);
  });
}
