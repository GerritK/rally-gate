import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseDeviceStatus,
  parseWifiList,
  splitTerse,
  validateWifi,
} from './network';

describe('splitTerse', () => {
  it('splits on unescaped colons', () => {
    assert.deepEqual(splitTerse('wlan0:wifi:connected:Rally'), [
      'wlan0',
      'wifi',
      'connected',
      'Rally',
    ]);
  });

  it('keeps an escaped colon inside a field', () => {
    // An SSID may contain a colon; a plain split() drops such a network from
    // the list entirely, which is the bug this exists to prevent.
    assert.deepEqual(splitTerse('Rally\\:Net:72:WPA2'), [
      'Rally:Net',
      '72',
      'WPA2',
    ]);
  });

  it('keeps an escaped backslash', () => {
    assert.deepEqual(splitTerse('a\\\\b:1'), ['a\\b', '1']);
  });
});

describe('parseDeviceStatus', () => {
  it('reads the wifi row', () => {
    const rows = parseDeviceStatus(
      'wlan0:wifi:connected:Clubhaus\neth0:ethernet:unavailable:\n',
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      device: 'wlan0',
      type: 'wifi',
      state: 'connected',
      connection: 'Clubhaus',
    });
    assert.equal(rows[1].connection, '');
  });
});

describe('parseWifiList', () => {
  it('sorts by signal and marks open networks', () => {
    const networks = parseWifiList(
      ':Weak:20:WPA2\n:OpenNet:55:--\n:Strong:88:WPA2\n',
    );
    assert.deepEqual(
      networks.map((n) => n.ssid),
      ['Strong', 'OpenNet', 'Weak'],
    );
    assert.equal(networks[1].secured, false);
    assert.equal(networks[0].secured, true);
  });

  it('keeps only the strongest reading of a repeated SSID', () => {
    const networks = parseWifiList(
      ':Mesh:31:WPA2\n*:Mesh:12:WPA2\n:Mesh:77:WPA2\n',
    );
    assert.deepEqual(networks, [
      { ssid: 'Mesh', signal: 77, secured: true, inUse: true },
    ]);
  });

  it('drops hidden networks, which have no name to click', () => {
    assert.equal(parseWifiList('::44:WPA2\n:Named:10:WPA2\n').length, 1);
  });
});

describe('validateWifi', () => {
  it('accepts a secured network', () => {
    assert.deepEqual(
      validateWifi({ ssid: 'Clubhaus', password: 'hunter22' }),
      {},
    );
  });

  it('accepts an open network with no password', () => {
    assert.deepEqual(validateWifi({ ssid: 'Clubhaus', password: '' }), {});
  });

  it('rejects an SSID nmcli would read as one of its own options', () => {
    assert.notEqual(
      validateWifi({ ssid: '-x', password: 'hunter22' }).ssid,
      undefined,
    );
  });

  it('rejects a line break in the SSID', () => {
    assert.notEqual(
      validateWifi({ ssid: 'a\nb', password: 'hunter22' }).ssid,
      undefined,
    );
  });

  it('rejects an SSID over 32 bytes, counting bytes not characters', () => {
    // 17 two-byte characters fit in 32 *characters* but not in 32 bytes, which
    // is the limit an access point actually has.
    assert.notEqual(validateWifi({ ssid: 'ü'.repeat(17) }).ssid, undefined);
    assert.equal(validateWifi({ ssid: 'ü'.repeat(16) }).ssid, undefined);
  });

  it('rejects a password shorter than WPA2 allows', () => {
    assert.notEqual(
      validateWifi({ ssid: 'Clubhaus', password: 'short' }).password,
      undefined,
    );
  });

  it('rejects a password longer than WPA2 allows', () => {
    assert.notEqual(
      validateWifi({ ssid: 'Clubhaus', password: 'x'.repeat(64) }).password,
      undefined,
    );
  });

  it('requires an SSID', () => {
    assert.notEqual(validateWifi({}).ssid, undefined);
  });
});
