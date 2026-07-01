import { describe, it, expect } from 'vitest';
import { discoverGateways } from '../../src/discovery/discovery.js';
import type { UdpMessage, UdpSocketLike } from '../../src/discovery/socket.js';
import { CMD_BROADCAST } from '../../src/discovery/protocol.js';

/** Encode a valid CMD_BROADCAST response frame for a fake gateway. */
function frameFor(mac: number[], ssid: string): Buffer {
  const ssidB = Buffer.from(ssid, 'ascii');
  const body = Buffer.concat([
    Buffer.from([CMD_BROADCAST, 0x00, 0x00]),
    Buffer.from(mac),
    Buffer.from([0xc0, 0xa8, 0x04, 0x01]), // stale SoftAP IP in the payload
    Buffer.from([0xaf, 0xc8]),
    Buffer.from([ssidB.length]),
    ssidB,
  ]);
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum = (sum + body[i]!) & 0xff;
  return Buffer.concat([Buffer.from([0xff, 0xff]), body, Buffer.from([sum])]);
}

function fakeSocket(replies: Array<{ frame: Buffer; address: string }>): UdpSocketLike {
  let handler: (m: UdpMessage) => void = () => {};
  return {
    send: async () => {
      for (const r of replies) handler({ data: r.frame, address: r.address, port: 46000 });
      // a stray non-gateway packet must be ignored
      handler({ data: Buffer.from('garbage'), address: '9.9.9.9', port: 1 });
    },
    onMessage: (h) => {
      handler = h;
    },
    setBroadcast: () => {},
    close: async () => {},
  };
}

describe('discoverGateways', () => {
  it('returns gateways keyed off the responder address, deduped by MAC', async () => {
    const socket = fakeSocket([
      { frame: frameFor([0xbc, 0xff, 0x4d, 0x1c, 0xc3, 0xf6], 'GW1100A-WIFIC3F6 V2.4.5'), address: '192.168.20.181' },
      { frame: frameFor([0xbc, 0xff, 0x4d, 0x1c, 0xc3, 0xf6], 'GW1100A-WIFIC3F6 V2.4.5'), address: '192.168.20.181' },
      { frame: frameFor([0x11, 0x22, 0x33, 0x44, 0x55, 0x66], 'GW2000A-WIFIABCD V3.1.2'), address: '192.168.20.50' },
    ]);
    const found = await discoverGateways(socket, { timeoutMs: 20 });
    expect(found).toHaveLength(2);
    // IP comes from the responder address, NOT the stale 192.168.4.1 in the payload.
    expect(found.find((g) => g.mac === 'bc:ff:4d:1c:c3:f6')).toEqual({
      ip: '192.168.20.181',
      mac: 'bc:ff:4d:1c:c3:f6',
      name: 'GW1100A-WIFIC3F6',
      model: 'GW1100A',
      firmware: 'V2.4.5',
    });
    expect(found.find((g) => g.mac === '11:22:33:44:55:66')?.ip).toBe('192.168.20.50');
  });

  it('resolves an empty array when nothing answers', async () => {
    const found = await discoverGateways(fakeSocket([]), { timeoutMs: 20 });
    expect(found).toEqual([]);
  });
});
