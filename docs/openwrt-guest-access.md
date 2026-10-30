# Public page on an OpenWRT guest network

For whoever runs the rally router. The result: phones on the guest Wi-Fi open
`http://rally.lan:57430/public`, while everything else on the timing LAN stays
closed. This needs no fixed IP and no change on the server laptop, so whichever
laptop runs rally-server that day is found.

Assumes OpenWRT with fw4, a guest network set up the usual way (interface and
firewall zone both `guest`, forwarding to `wan` only), and the server on the
`lan` zone. Replace the example subnets: LAN `10.43.0.0/24`, guest `10.10.0.0/16`.

## 1. Firewall: guests reach 57430, nothing else

```sh
uci set firewall.rallygate_public=rule
uci set firewall.rallygate_public.name='Guest-RallyGate-Public'
uci set firewall.rallygate_public.src='guest'
uci set firewall.rallygate_public.dest='lan'
uci set firewall.rallygate_public.dest_port='57430'
uci set firewall.rallygate_public.proto='tcp'
uci set firewall.rallygate_public.target='ACCEPT'

uci set firewall.rallygate_snat=nat
uci set firewall.rallygate_snat.name='Guest-RallyGate-SNAT'
uci set firewall.rallygate_snat.src='lan'
uci set firewall.rallygate_snat.src_ip='10.10.0.0/16'
uci set firewall.rallygate_snat.dest_port='57430'
uci set firewall.rallygate_snat.proto='tcp'
uci set firewall.rallygate_snat.target='MASQUERADE'

uci commit firewall && service firewall restart
```

There is no `dest_ip`, so any LAN host qualifies. 57430 is Rally Gate's own
port, and nothing else on the LAN listens there. The masquerade is needed
because rally-server's Windows firewall rule allows the local subnet only
(`apps/rally-server/src/windows-firewall.ts`). It has a cost: every guest
reaches the server from the router's address, so the `/auth/login` limit
(5 wrong passwords a minute per address) is shared by all guests.
Staff on the LAN are not affected.

Never open 57431 (MQTT) or 57432 (SNTP) to guests. Never put a reverse proxy on
the server machine itself, because a loopback client is the organiser
(`api.md`).

## 2. `rally.lan` follows the server over mDNS

rally-server advertises `_rally-gate._tcp` over mDNS. The router browses for it
once a minute and writes the address to a hosts file that dnsmasq reads.

```sh
apk add avahi-dbus-daemon avahi-utils        # opkg install … before OpenWRT 25
sed -i 's/^#\?allow-interfaces=.*/allow-interfaces=br-lan/' /etc/avahi/avahi-daemon.conf
grep -q '^allow-interfaces' /etc/avahi/avahi-daemon.conf || sed -i '/^\[server\]/a allow-interfaces=br-lan' /etc/avahi/avahi-daemon.conf
service dbus enable && service dbus restart  # restart: D-Bus only reads Avahi's policy on start
service avahi-daemon enable && service avahi-daemon restart

cat > /usr/bin/rally-dns.sh <<'EOF'
#!/bin/sh
IP=$(avahi-browse -r -p -t _rally-gate._tcp 2>/dev/null | awk -F';' '$1=="=" && $3=="IPv4" && $8 ~ /^10\.43\.0\./ {print $8; exit}')
NEW="${IP:+$IP rally rally.lan}"
[ "$NEW" = "$(cat /tmp/hosts/rally 2>/dev/null)" ] && exit 0
echo "$NEW" > /tmp/hosts/rally
killall -HUP dnsmasq
EOF
chmod +x /usr/bin/rally-dns.sh
grep -q rally-dns /etc/crontabs/root || echo '* * * * * /usr/bin/rally-dns.sh' >> /etc/crontabs/root
service cron enable && service cron restart
```

`allow-interfaces=br-lan` keeps Avahi off the guest network. Without it, a guest
could announce `_rally-gate._tcp` and point `rally.lan` at their own device.
Check the device name with `uci get network.lan.device`. The LAN prefix filter
in the script drops any address the server advertises outside the LAN.

## 3. Check

```sh
avahi-browse -r -p -t _rally-gate._tcp       # expect the server's LAN address
/usr/bin/rally-dns.sh; cat /tmp/hosts/rally
nslookup rally.lan 10.10.0.1                 # the guest-side address answers too
```

Then, from a phone on the guest Wi-Fi, open `http://rally.lan:57430/public`.

## Gotchas

- **The server laptop needs exactly one connection.** On Ethernet *and* Wi-Fi,
  rally-server may advertise the Wi-Fi address (a known limit in
  `apps/rally-server/src/modules/discovery/discovery.service.ts`). The script then leaves `rally.lan` empty, and gates
  can't find the server either.
- **`.local` never works from the guest side.** mDNS stays on the LAN by
  design. Post `rally.lan` on the notice.
- **Phones with a fixed Private DNS, or Chrome's secure DNS set to a fixed
  provider,** skip the router and get NXDOMAIN. Post the IP as a fallback. To
  see whether a query reaches the router at all:
  `uci set dhcp.@dnsmasq[0].logqueries='1'`, restart dnsmasq, then
  `logread -f | grep rally`.
- **After a server swap,** `rally.lan` follows within one cron minute.

## Undo

```sh
uci delete firewall.rallygate_public; uci delete firewall.rallygate_snat
uci commit firewall && service firewall restart
sed -i '/rally-dns/d' /etc/crontabs/root && service cron restart
rm -f /usr/bin/rally-dns.sh /tmp/hosts/rally && killall -HUP dnsmasq
```
