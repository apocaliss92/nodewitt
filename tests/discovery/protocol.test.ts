import { describe, it, expect } from 'vitest';
import {
  buildScanPacket,
  parseBroadcastResponse,
  verifyChecksum,
  CMD_BROADCAST,
} from '../../src/discovery/protocol.js';

// Captured from a live GW1100A gateway (192.168.20.181) answering the CMD_BROADCAST probe.
const REAL_FRAME_HEX =
  'ffff120027bcff4d1cc3f6c0a80401afc817475731313030412d57494649433346362056322e342e356d';

describe('buildScanPacket', () => {
  it('builds FF FF 12 03 15 with a valid trailing checksum', () => {
    const pkt = buildScanPacket();
    expect(pkt.toString('hex')).toBe('ffff120315');
    expect(verifyChecksum(pkt)).toBe(true);
    expect(pkt[2]).toBe(CMD_BROADCAST);
  });
});

describe('parseBroadcastResponse', () => {
  it('decodes a real gateway frame', () => {
    const frame = parseBroadcastResponse(Buffer.from(REAL_FRAME_HEX, 'hex'));
    expect(frame).not.toBeNull();
    expect(frame).toEqual({
      mac: 'bc:ff:4d:1c:c3:f6',
      module: 'GW1100A-WIFIC3F6',
      model: 'GW1100A',
      firmware: 'V2.4.5',
      tcpPort: 45000,
    });
  });

  it('rejects a frame with a bad checksum', () => {
    const buf = Buffer.from(REAL_FRAME_HEX, 'hex');
    buf[buf.length - 1] = (buf[buf.length - 1]! + 1) & 0xff;
    expect(parseBroadcastResponse(buf)).toBeNull();
  });

  it('rejects a non-broadcast / wrong-header packet', () => {
    expect(parseBroadcastResponse(Buffer.from([0x00, 0x00, 0x12, 0x03, 0x15]))).toBeNull();
    expect(parseBroadcastResponse(Buffer.from([0xff, 0xff, 0x99, 0x03]))).toBeNull();
  });

  it('rejects a too-short buffer', () => {
    expect(parseBroadcastResponse(Buffer.from([0xff, 0xff, 0x12]))).toBeNull();
  });

  it('leaves model/firmware undefined when the SSID lacks the usual shape', () => {
    // Build a minimal valid frame whose SSID is a bare token with no "-WIFI" and no firmware suffix.
    const ssid = Buffer.from('PLAINNAME', 'ascii');
    const body = Buffer.concat([
      Buffer.from([CMD_BROADCAST, 0x00, 0x00]), // cmd + 2-byte size placeholder
      Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]), // mac
      Buffer.from([0xc0, 0xa8, 0x00, 0x0a]), // ip
      Buffer.from([0xaf, 0xc8]), // port 45000
      Buffer.from([ssid.length]), // ssid length
      ssid,
    ]);
    // size field (u16 BE) is cosmetic to the parser (it reads structurally) — leave 0.
    let sum = 0;
    for (let i = 0; i < body.length; i += 1) sum = (sum + body[i]!) & 0xff;
    const buf = Buffer.concat([Buffer.from([0xff, 0xff]), body, Buffer.from([sum])]);
    const frame = parseBroadcastResponse(buf);
    expect(frame).toMatchObject({ module: 'PLAINNAME', model: undefined, firmware: undefined });
  });
});
