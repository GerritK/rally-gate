import {
  buildNtpResponse,
  readNtpTimestamp,
  writeNtpTimestamp,
} from './ntp.service';

const NTP_PACKET_BYTES = 48;
const OFFSET_ORIGIN_TS = 24;
const OFFSET_RECEIVE_TS = 32;
const OFFSET_TRANSMIT_TS = 40;

function clientRequest(transmitAtMs: number, mode = 3, version = 4): Buffer {
  const packet = Buffer.alloc(NTP_PACKET_BYTES);
  packet[0] = (version << 3) | mode;
  packet[2] = 6; // poll
  writeNtpTimestamp(packet, OFFSET_TRANSMIT_TS, transmitAtMs);
  return packet;
}

describe('NTP timestamps', () => {
  it('writes the Unix epoch as the NTP epoch offset', () => {
    const buffer = Buffer.alloc(8);
    writeNtpTimestamp(buffer, 0, 0);
    expect(buffer.readUInt32BE(0)).toBe(2_208_988_800);
    expect(buffer.readUInt32BE(4)).toBe(0);
  });

  it('writes half a second as half the fraction field', () => {
    const buffer = Buffer.alloc(8);
    writeNtpTimestamp(buffer, 0, 500);
    expect(buffer.readUInt32BE(4)).toBe(0x80000000);
  });

  it('round-trips a real timestamp to within a millisecond', () => {
    const buffer = Buffer.alloc(8);
    const now = Date.UTC(2026, 8, 24, 10, 30, 15, 123);
    writeNtpTimestamp(buffer, 0, now);
    expect(readNtpTimestamp(buffer, 0)).toBeCloseTo(now, 0);
  });
});

describe('buildNtpResponse', () => {
  it('ignores a packet shorter than an NTP header', () => {
    expect(buildNtpResponse(Buffer.alloc(20), 1000, 1000)).toBeNull();
  });

  it.each([
    ['control (mode 6)', 6],
    ['private (mode 7)', 7],
    ['server (mode 4)', 4],
  ])(
    'ignores %s packets, so it cannot be used as a reflector',
    (_label, mode) => {
      expect(
        buildNtpResponse(clientRequest(1000, mode), 1000, 1000),
      ).toBeNull();
    },
  );

  it('answers a client packet as a server packet, echoing its version', () => {
    const response = buildNtpResponse(clientRequest(1000, 3, 3), 2000, 2000)!;
    expect(response).not.toBeNull();
    expect(response[0] & 0b111).toBe(4);
    expect((response[0] >> 3) & 0b111).toBe(3);
    expect(response.length).toBe(NTP_PACKET_BYTES);
  });

  it("returns the client's transmit timestamp byte-for-byte as origin", () => {
    const request = clientRequest(1_700_000_123_456);
    const response = buildNtpResponse(request, 2000, 2000)!;
    expect(
      response
        .subarray(OFFSET_ORIGIN_TS, OFFSET_ORIGIN_TS + 8)
        .equals(request.subarray(OFFSET_TRANSMIT_TS, OFFSET_TRANSMIT_TS + 8)),
    ).toBe(true);
  });

  it('reports receive and transmit separately, so the client can subtract its own processing delay', () => {
    const response = buildNtpResponse(clientRequest(1000), 5000, 5007)!;
    expect(readNtpTimestamp(response, OFFSET_RECEIVE_TS)).toBeCloseTo(5000, 0);
    expect(readNtpTimestamp(response, OFFSET_TRANSMIT_TS)).toBeCloseTo(5007, 0);
  });

  // The check that actually matters: everything above can pass with a wrong
  // epoch constant or byte order and still leave clients silently skewed. This
  // runs NTP's own offset formula over a full exchange, which is what a gate
  // does to decide how far to move its clock.
  it('lets a client recover a known clock offset from a full exchange', () => {
    const clientBehindMs = 5_000;
    const oneWayLatencyMs = 4;

    const serverReceivedAt = Date.UTC(2026, 8, 24, 12, 0, 0, 0);
    const clientTransmittedAt =
      serverReceivedAt - clientBehindMs - oneWayLatencyMs;
    const serverTransmittedAt = serverReceivedAt + 2;
    const clientReceivedAt =
      serverTransmittedAt - clientBehindMs + oneWayLatencyMs;

    const response = buildNtpResponse(
      clientRequest(clientTransmittedAt),
      serverReceivedAt,
      serverTransmittedAt,
    )!;

    const t1 = readNtpTimestamp(response, OFFSET_ORIGIN_TS);
    const t2 = readNtpTimestamp(response, OFFSET_RECEIVE_TS);
    const t3 = readNtpTimestamp(response, OFFSET_TRANSMIT_TS);
    const t4 = clientReceivedAt;

    const offset = (t2 - t1 + (t3 - t4)) / 2;
    const roundTrip = t4 - t1 - (t3 - t2);

    expect(offset).toBeCloseTo(clientBehindMs, 0);
    expect(roundTrip).toBeCloseTo(oneWayLatencyMs * 2, 0);
  });
});
