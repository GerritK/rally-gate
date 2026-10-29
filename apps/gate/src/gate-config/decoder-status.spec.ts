import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseStatusLine } from './decoder-status';

describe('parseStatusLine', () => {
  it('reads the fields of an older release, which ends at frames_processed', () => {
    assert.deepEqual(parseStatusLine('S 1791564181865 -42.24 1.35 0 0'), {
      noisePower: -42.24,
      dcOffset: 1.35,
      framesReceived: 0,
      framesProcessed: 0,
    });
  });

  it('ignores fields a newer release appends', () => {
    assert.deepEqual(parseStatusLine('S 1791564181865 -40.1 2.5 12 9 0.8'), {
      noisePower: -40.1,
      dcOffset: 2.5,
      framesReceived: 12,
      framesProcessed: 9,
    });
  });

  it('rejects anything else', () => {
    assert.equal(parseStatusLine('P 1791234567890 OPN 1615544 -3.50 64'), null);
    assert.equal(parseStatusLine('S 1791564181865 -42.24'), null);
    assert.equal(parseStatusLine('S 1791564181865 x 1.35 0 0'), null);
    assert.equal(parseStatusLine(''), null);
  });
});
