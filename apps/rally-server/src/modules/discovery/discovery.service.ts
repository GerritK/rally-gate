import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Bonjour, Service } from 'bonjour-service';
import { networkInterfaces, NetworkInterfaceInfo } from 'os';

/**
 * The mDNS name gates resolve. Publishing a *name* rather than expecting gates
 * to browse for a service is what keeps the gate side codeless: `gate-agent`
 * resolves it through plain getaddrinfo like any hostname, and so does chrony,
 * so one advertisement covers both MQTT and time with no discovery logic to
 * write, test, or debug in the field.
 *
 * Overridable because two clubs at a joint event would otherwise publish the
 * same name on one network — the same collision `GATE_ID` is prefixed to avoid
 * (see "Gate discovery & heartbeat" in docs/architecture.md).
 */
const DEFAULT_MDNS_HOST = 'rally-server.local';

// ponytail: adapter-name heuristic, not per-interface answers; a real
// responder (avahi) answers each query with the address of the interface it
// arrived on, which bonjour-service can't do.
const VIRTUAL_ADAPTER =
  /^(vEthernet|docker|br-|veth|virbr|vboxnet|VirtualBox|VMware|tailscale|ZeroTier|tun|tap|utun)/i;

/**
 * The IPv4 addresses a gate could actually reach. bonjour-service advertises
 * every address the host has, and nss-mdns on the gate picks just one, so a
 * Hyper-V switch or link-local address on a Windows laptop makes the gate
 * connect somewhere unreachable (a hanging connect, reported as mqtt.js'
 * "connack timeout").
 */
export function lanAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string[] {
  return Object.entries(interfaces)
    .filter(([name]) => !VIRTUAL_ADAPTER.test(name))
    .flatMap(([, addrs]) => addrs ?? [])
    .filter(
      (a) =>
        a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'),
    )
    .map((a) => a.address);
}

@Injectable()
export class DiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiscoveryService.name);
  private bonjour?: Bonjour;
  private service?: Service;

  onModuleInit() {
    if (process.env.MDNS_DISABLE === '1') {
      this.logger.log('mDNS advertisement disabled (MDNS_DISABLE=1)');
      return;
    }

    const host = process.env.MDNS_HOST ?? DEFAULT_MDNS_HOST;
    const mqttPort = Number(process.env.MQTT_PORT ?? 57431);

    try {
      this.bonjour = new Bonjour();
      this.service = this.bonjour.publish({
        name: host.replace(/\.local$/, ''),
        type: 'rally-gate',
        protocol: 'tcp',
        host,
        // Gates resolve with mdns4_minimal, and a link-local IPv6 answer is
        // useless without its scope id anyway.
        disableIPv6: true,
        // The service port is the broker's, since that is what a gate connects
        // to. The others ride along in TXT for the planned gate config UI,
        // which needs to show what it found rather than resolve one name.
        port: mqttPort,
        txt: {
          mqtt: String(mqttPort),
          ntp: String(process.env.NTP_PORT ?? 57432),
          api: String(process.env.PORT ?? 57430),
        },
      });
      const allRecords = this.service.records.bind(
        this.service,
      ) as Service['records'];
      const lan = lanAddresses();
      if (lan.length > 0) {
        this.service.records = () =>
          allRecords().filter(
            // ServiceRecord.data is typed `any`; narrowed here for the linter.
            (r: { type: string; data: unknown }) =>
              r.type !== 'A' || lan.includes(r.data as string),
          );
      }
      this.logger.log(
        `Advertising ${host} over mDNS as ${lan.join(', ') || 'every address'} (_rally-gate._tcp, mqtt ${mqttPort})`,
      );
    } catch (err) {
      // Never fatal. mDNS is a convenience that removes a typed-in address;
      // every gate can still be pointed at an IP by hand, which is the
      // documented fallback for APs that block multicast anyway.
      this.logger.warn(
        `Could not advertise over mDNS: ${(err as Error).message}. ` +
          'Gates will need an explicit address.',
      );
    }
  }

  onModuleDestroy() {
    // Actively withdrawn rather than left to time out: a restarted server that
    // came up on a new DHCP lease would otherwise be shadowed by its own stale
    // record for as long as the TTL holds.
    this.service?.stop?.();
    this.bonjour?.destroy();
  }
}
