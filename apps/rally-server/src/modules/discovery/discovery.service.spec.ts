import { NetworkInterfaceInfo } from 'os';
import { lanAddresses } from './discovery.service';

const v4 = (address: string, internal = false) =>
  ({ family: 'IPv4', address, internal }) as NetworkInterfaceInfo;

describe('lanAddresses', () => {
  it('keeps only addresses a gate on the LAN could reach', () => {
    // A real Windows laptop: Wi-Fi and USB tethering on the rally network,
    // plus a Hyper-V switch and link-local adapters a gate can never reach.
    expect(
      lanAddresses({
        WLAN: [
          v4('192.168.43.86'),
          { family: 'IPv6', address: 'fe80::1' } as NetworkInterfaceInfo,
        ],
        'Ethernet 6': [v4('192.168.43.42')],
        'vEthernet (Default Switch)': [v4('172.27.16.1')],
        'Bluetooth-Netzwerkverbindung 6': [v4('169.254.187.240')],
        'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
      }),
    ).toEqual(['192.168.43.86', '192.168.43.42']);
  });
});
