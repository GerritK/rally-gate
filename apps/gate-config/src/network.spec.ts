import {
  parseDeviceStatus,
  parseWifiList,
  splitTerse,
  validateWifi,
} from './network';

describe('splitTerse', () => {
  it('splits on unescaped colons', () => {
    expect(splitTerse('wlan0:wifi:connected:Rally')).toEqual([
      'wlan0',
      'wifi',
      'connected',
      'Rally',
    ]);
  });

  it('keeps an escaped colon inside a field', () => {
    // An SSID may contain a colon; a plain split() drops such a network from
    // the list entirely, which is the bug this exists to prevent.
    expect(splitTerse('Rally\\:Net:72:WPA2')).toEqual([
      'Rally:Net',
      '72',
      'WPA2',
    ]);
  });

  it('keeps an escaped backslash', () => {
    expect(splitTerse('a\\\\b:1')).toEqual(['a\\b', '1']);
  });
});

describe('parseDeviceStatus', () => {
  it('reads the wifi row', () => {
    const rows = parseDeviceStatus(
      'wlan0:wifi:connected:Clubhaus\neth0:ethernet:unavailable:\n',
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      device: 'wlan0',
      type: 'wifi',
      state: 'connected',
      connection: 'Clubhaus',
    });
    expect(rows[1].connection).toBe('');
  });
});

describe('parseWifiList', () => {
  it('sorts by signal and marks open networks', () => {
    const networks = parseWifiList(
      'Weak:20:WPA2\nOpenNet:55:--\nStrong:88:WPA2\n',
    );
    expect(networks.map((n) => n.ssid)).toEqual(['Strong', 'OpenNet', 'Weak']);
    expect(networks[1].secured).toBe(false);
    expect(networks[0].secured).toBe(true);
  });

  it('keeps only the strongest reading of a repeated SSID', () => {
    const networks = parseWifiList(
      'Mesh:31:WPA2\nMesh:77:WPA2\nMesh:12:WPA2\n',
    );
    expect(networks).toEqual([{ ssid: 'Mesh', signal: 77, secured: true }]);
  });

  it('drops hidden networks, which have no name to click', () => {
    expect(parseWifiList(':44:WPA2\nNamed:10:WPA2\n')).toHaveLength(1);
  });
});

describe('validateWifi', () => {
  it('accepts a secured network', () => {
    expect(validateWifi({ ssid: 'Clubhaus', password: 'hunter22' })).toEqual(
      {},
    );
  });

  it('accepts an open network with no password', () => {
    expect(validateWifi({ ssid: 'Clubhaus', password: '' })).toEqual({});
  });

  it('rejects an SSID nmcli would read as one of its own options', () => {
    expect(
      validateWifi({ ssid: '-x', password: 'hunter22' }).ssid,
    ).toBeDefined();
  });

  it('rejects a line break in the SSID', () => {
    expect(
      validateWifi({ ssid: 'a\nb', password: 'hunter22' }).ssid,
    ).toBeDefined();
  });

  it('rejects an SSID over 32 bytes, counting bytes not characters', () => {
    // 17 two-byte characters fit in 32 *characters* but not in 32 bytes, which
    // is the limit an access point actually has.
    expect(validateWifi({ ssid: 'ü'.repeat(17) }).ssid).toBeDefined();
    expect(validateWifi({ ssid: 'ü'.repeat(16) }).ssid).toBeUndefined();
  });

  it('rejects a password shorter than WPA2 allows', () => {
    expect(
      validateWifi({ ssid: 'Clubhaus', password: 'short' }).password,
    ).toBeDefined();
  });

  it('rejects a password longer than WPA2 allows', () => {
    expect(
      validateWifi({ ssid: 'Clubhaus', password: 'x'.repeat(64) }).password,
    ).toBeDefined();
  });

  it('requires an SSID', () => {
    expect(validateWifi({}).ssid).toBeDefined();
  });
});
