// Which addresses the collection job may connect to (.docs/design/rules.md, 抓取的限制): public
// unicast addresses only. Private, loopback, link-local (including the cloud metadata address
// 169.254.169.254), shared, documentation, benchmarking, multicast and reserved ranges are
// refused. For IPv6 only global unicast (2000::/3) is allowed, without its special-purpose
// ranges, so IPv4-mapped, NAT64, unique-local and site-local addresses are refused too.
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export type ResolvedAddress = { address: string; family: 4 | 6 };

/** Finds the addresses of a host name; the job checks every one before it connects. */
export type HostResolver = (hostname: string) => Promise<readonly ResolvedAddress[]>;

const NON_PUBLIC_IPV4: readonly [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const NON_PUBLIC_GLOBAL_IPV6: readonly [string, number][] = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['2620:4f:8000::', 48],
  ['3fff::', 20],
];

function blockListOf(ranges: readonly [string, number][], type: 'ipv4' | 'ipv6') {
  const list = new BlockList();
  for (const [network, prefix] of ranges) {
    list.addSubnet(network, prefix, type);
  }
  return list;
}

const nonPublicIpv4 = blockListOf(NON_PUBLIC_IPV4, 'ipv4');
const globalUnicastIpv6 = blockListOf([['2000::', 3]], 'ipv6');
const nonPublicGlobalIpv6 = blockListOf(NON_PUBLIC_GLOBAL_IPV6, 'ipv6');

/** Whether an IP address is a public unicast address the job may connect to. */
export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !nonPublicIpv4.check(address, 'ipv4');
    case 6:
      return (
        globalUnicastIpv6.check(address, 'ipv6') && !nonPublicGlobalIpv6.check(address, 'ipv6')
      );
    default:
      return false;
  }
}

/** The system's resolver, returning every address of the name in the order it gives them. */
export const systemResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, order: 'verbatim' });
  return addresses.map(({ address, family }) => ({ address, family: family === 6 ? 6 : 4 }));
};
