import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createSocket, Socket } from 'dgram';

/**
 * Seconds between the NTP epoch (1900-01-01) and the Unix epoch (1970-01-01).
 * The 32-bit seconds field wraps in 2036; NTP handles that with eras, which
 * nothing here needs to implement before then.
 */
const NTP_EPOCH_OFFSET_SECONDS = 2_208_988_800;
const NTP_PACKET_BYTES = 48;

const MODE_CLIENT = 3;
const MODE_SERVER = 4;

// Field offsets within the packet (RFC 5905 section 7.3).
const OFFSET_REFERENCE_ID = 12;
const OFFSET_REFERENCE_TS = 16;
const OFFSET_ORIGIN_TS = 24;
const OFFSET_RECEIVE_TS = 32;
const OFFSET_TRANSMIT_TS = 40;

/**
 * Deliberately poor, mirroring chrony's own `local stratum 10` convention: this
 * clock is only a shared reference, so any real upstream a client can also see
 * should win over it. See docs/architecture.md "Clock offset" for why gates
 * agreeing with each other is the requirement, not absolute correctness.
 */
const STRATUM = 10;

/** log2 seconds. Date.now() has millisecond resolution, so ~2^-10. */
const PRECISION = -10;

/** 16.16 fixed-point seconds. ~1ms, matching PRECISION — not zero, which would
 * advertise this as a perfect source. */
const ROOT_DISPERSION = 66;

/** Reference id for an undisciplined local clock, by convention. */
const REFERENCE_ID = 'LOCL';

export function writeNtpTimestamp(
  target: Buffer,
  offset: number,
  unixMs: number,
): void {
  const seconds = Math.floor(unixMs / 1000) + NTP_EPOCH_OFFSET_SECONDS;
  // Clamped because a fractional input millisecond could otherwise round up to
  // 2^32, which writeUInt32BE rejects.
  const fraction = Math.min(
    Math.round(((unixMs % 1000) / 1000) * 2 ** 32),
    0xffffffff,
  );
  target.writeUInt32BE(seconds, offset);
  target.writeUInt32BE(fraction, offset + 4);
}

export function readNtpTimestamp(source: Buffer, offset: number): number {
  const seconds = source.readUInt32BE(offset) - NTP_EPOCH_OFFSET_SECONDS;
  const fraction = source.readUInt32BE(offset + 4) / 2 ** 32;
  return seconds * 1000 + fraction * 1000;
}

/**
 * Returns the reply to send, or null if the packet should be ignored.
 *
 * `receivedAtMs` and `transmitAtMs` are read separately by the caller on
 * purpose: the client subtracts the two to remove this server's own processing
 * delay from its round-trip estimate, so collapsing them into one reading
 * would quietly charge that delay to the network.
 */
export function buildNtpResponse(
  request: Buffer,
  receivedAtMs: number,
  transmitAtMs: number,
): Buffer | null {
  if (request.length < NTP_PACKET_BYTES) {
    return null;
  }
  // Only mode 3 (client) is answered. Modes 6 and 7 are ntpd's control and
  // private protocols, whose replies are far larger than the request — the
  // classic NTP reflection amplifier. A mode 4 reply is the same 48 bytes as
  // the request, so this service cannot amplify.
  if ((request[0] & 0b111) !== MODE_CLIENT) {
    return null;
  }

  const version = (request[0] >> 3) & 0b111;
  const response = Buffer.alloc(NTP_PACKET_BYTES);

  response[0] = (version << 3) | MODE_SERVER; // leap indicator 0
  response[1] = STRATUM;
  response[2] = request[2]; // echo the client's poll interval
  response.writeInt8(PRECISION, 3);
  // Root delay stays 0: there is no upstream to be delayed from.
  response.writeUInt32BE(ROOT_DISPERSION, 8);
  response.write(REFERENCE_ID, OFFSET_REFERENCE_ID, 'ascii');
  writeNtpTimestamp(response, OFFSET_REFERENCE_TS, receivedAtMs);

  // Copied as raw bytes rather than converted through a number: this field is
  // the client's own transmit timestamp coming back, and it compares it for
  // equality to match the reply to its request.
  request.copy(
    response,
    OFFSET_ORIGIN_TS,
    OFFSET_TRANSMIT_TS,
    OFFSET_TRANSMIT_TS + 8,
  );
  writeNtpTimestamp(response, OFFSET_RECEIVE_TS, receivedAtMs);
  writeNtpTimestamp(response, OFFSET_TRANSMIT_TS, transmitAtMs);

  return response;
}

/**
 * Embedded SNTP server, for the same reason the MQTT broker is embedded: a gate
 * must not have to know what kind of machine rally-server runs on. A Pi server
 * could run host chrony, but a standalone laptop can't be asked to, so gates
 * would need per-deployment configuration — see "Zero-config gates" in
 * docs/development-roadmap.md.
 *
 * Serving on a project port rather than 123 is what makes that work: 123 needs
 * root/admin, which a double-clicked standalone executable does not have.
 * Clients point at it with chrony's `port` option on the source line.
 */
@Injectable()
export class NtpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NtpService.name);
  private socket?: Socket;

  async onModuleInit() {
    const port = Number(process.env.NTP_PORT ?? 57433);
    // Dual-stack, not 'udp4'. The MQTT broker already binds `::` via
    // net.createServer, and a gate resolves rally-server by mDNS name — which
    // can hand it an IPv6 address on a network that has one. An IPv4-only
    // socket would then leave that gate with no time source and no error
    // anywhere, which is the exact silent-desync failure this service exists
    // to prevent. ipv6Only:false accepts IPv4-mapped packets on the same socket.
    const socket = createSocket({ type: 'udp6', ipv6Only: false });

    socket.on('message', (request, remote) => {
      const receivedAt = Date.now();
      const response = buildNtpResponse(request, receivedAt, Date.now());
      if (!response) {
        return;
      }
      socket.send(response, remote.port, remote.address, (err) => {
        if (err) {
          this.logger.warn(
            `Failed to answer time request from ${remote.address}: ${err.message}`,
          );
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, () => {
        this.logger.log(`Embedded NTP server listening on port ${port}/udp`);
        resolve();
      });
    }).catch((err: NodeJS.ErrnoException) => {
      // Logged and swallowed, unlike the broker's bind failure which aborts
      // startup. A gate with no time source still delivers detections, and the
      // heartbeat offset measurement (GatesService) makes the resulting skew
      // visible on the Hardware page — whereas refusing to start would take
      // timing down entirely to protect it.
      this.logger.error(
        `Embedded NTP server cannot listen on port ${port}/udp: ${err.message}. ` +
          'Gates will fall back to whatever other time source they have; watch ' +
          'the Hardware page clock column for drift.',
      );
      socket.close();
      return undefined;
    });

    socket.on('error', (err) =>
      this.logger.error(`Embedded NTP server error: ${err.message}`),
    );
    this.socket = socket;
  }

  onModuleDestroy() {
    this.socket?.close();
  }
}
