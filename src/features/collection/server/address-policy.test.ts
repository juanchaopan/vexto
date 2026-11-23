import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './address-policy.ts';

describe('isPublicAddress', () => {
  it.each(['93.184.215.14', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'])(
    'allows the public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback at the end of its range', '127.255.255.254'],
    ['this network', '0.0.0.0'],
    ['private 10/8', '10.1.2.3'],
    ['private 172.16/12', '172.31.255.1'],
    ['private 192.168/16', '192.168.0.10'],
    ['shared address space', '100.64.0.1'],
    ['link-local, the cloud metadata address', '169.254.169.254'],
    ['IETF protocol assignments', '192.0.0.8'],
    ['documentation', '203.0.113.7'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped metadata address', '::ffff:a9fe:a9fe'],
    ['NAT64', '64:ff9b::a9fe:a9fe'],
    ['unique local, the IPv6 metadata address', 'fd00:ec2::254'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['Teredo', '2001:0:4136:e378::1'],
    ['6to4', '2002:a9fe:a9fe::1'],
  ])('refuses the %s address %s', (_name, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('refuses anything that is not an IP address', () => {
    expect(isPublicAddress('example.org')).toBe(false);
    expect(isPublicAddress('')).toBe(false);
  });
});
