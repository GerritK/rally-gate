import { parseStatusLine } from './decoder-status';

describe('parseStatusLine', () => {
  it('reads the fields of an older release, which ends at frames_processed', () => {
    expect(parseStatusLine('S 1791564181865 -42.24 1.35 0 0')).toEqual({
      noisePower: -42.24,
      dcOffset: 1.35,
      framesReceived: 0,
      framesProcessed: 0,
    });
  });

  it('ignores fields a newer release appends', () => {
    expect(parseStatusLine('S 1791564181865 -40.1 2.5 12 9 0.8')).toEqual({
      noisePower: -40.1,
      dcOffset: 2.5,
      framesReceived: 12,
      framesProcessed: 9,
    });
  });

  it('rejects anything else', () => {
    expect(parseStatusLine('P 1791234567890 OPN 1615544 -3.50 64')).toBeNull();
    expect(parseStatusLine('S 1791564181865 -42.24')).toBeNull();
    expect(parseStatusLine('S 1791564181865 x 1.35 0 0')).toBeNull();
    expect(parseStatusLine('')).toBeNull();
  });
});
