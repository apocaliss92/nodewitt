import { createSocket, type Socket } from 'node:dgram';

/** A UDP datagram received on the discovery socket. */
export interface UdpMessage {
  readonly data: Buffer;
  readonly address: string;
  readonly port: number;
}

/**
 * Minimal UDP socket surface the discovery scan needs. The real implementation wraps `node:dgram`;
 * tests inject a fake so the scan can be driven without a real socket (mirrors
 * `@apocaliss92/nodegree`'s `UdpSocketLike`).
 */
export interface UdpSocketLike {
  send(data: Buffer, port: number, address: string): Promise<void>;
  onMessage(handler: (msg: UdpMessage) => void): void;
  setBroadcast(enabled: boolean): void;
  close(): Promise<void>;
}

/** Build a bound `node:dgram` UDP4 socket wrapped in {@link UdpSocketLike}. */
export function createDgramSocket(): Promise<UdpSocketLike> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.once('error', reject);
    socket.bind(() => {
      socket.removeListener('error', reject);
      resolve({
        send: (data, port, address) =>
          new Promise<void>((res, rej) =>
            socket.send(data, port, address, (err) => (err ? rej(err) : res())),
          ),
        onMessage: (handler) =>
          socket.on('message', (data, rinfo) =>
            handler({ data, address: rinfo.address, port: rinfo.port }),
          ),
        setBroadcast: (enabled) => socket.setBroadcast(enabled),
        close: () => new Promise<void>((res) => socket.close(() => res())),
      });
    });
  });
}
