import * as dns from 'dns';
import * as E from 'fp-ts/Either';
import { AGENT_REQUEST_HOST_BLOCKED } from 'src/errors';
import {
  SsrfGuardService,
  isBlockedAddress,
  matchesHostPattern,
} from './ssrf-guard.service';

const guard = new SsrfGuardService();
const OPEN = { allowedHosts: [] };

const mockLookup = (addresses: { address: string; family: number }[]) =>
  jest
    .spyOn(dns.promises, 'lookup')
    .mockResolvedValue(addresses as any);

describe('isBlockedAddress', () => {
  it.each([
    ['169.254.169.254', 'cloud metadata'],
    ['127.0.0.1', 'loopback'],
    ['10.1.2.3', 'RFC1918 /8'],
    ['172.16.0.1', 'RFC1918 /12'],
    ['172.31.255.255', 'RFC1918 /12 upper bound'],
    ['192.168.1.1', 'RFC1918 /16'],
    ['100.64.0.1', 'CGNAT'],
    ['0.0.0.0', 'this network'],
    ['::1', 'IPv6 loopback'],
    ['fc00::1', 'IPv6 unique local'],
    ['fe80::1', 'IPv6 link-local'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ])('should block %s (%s)', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1'])(
    'should allow public address %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );

  it('should refuse anything unparseable rather than guess', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('matchesHostPattern', () => {
  it('should match an exact host', () => {
    expect(matchesHostPattern('api.example.com', 'api.example.com')).toBe(true);
    expect(matchesHostPattern('evil.com', 'api.example.com')).toBe(false);
  });

  it('should match a wildcard subdomain but not the bare domain', () => {
    expect(matchesHostPattern('a.example.com', '*.example.com')).toBe(true);
    expect(matchesHostPattern('example.com', '*.example.com')).toBe(false);
  });

  it('should not let a suffix trick the wildcard', () => {
    expect(matchesHostPattern('notexample.com', '*.example.com')).toBe(false);
  });

  it('should ignore a port on the pattern', () => {
    expect(matchesHostPattern('api.example.com', 'api.example.com:8443')).toBe(
      true,
    );
  });
});

describe('SsrfGuardService.check', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com',
    'data:text/plain,hi',
  ])('should reject the %s scheme', async (url) => {
    const result = await guard.check(url, OPEN);
    expect(E.isLeft(result)).toBe(true);
  });

  it('should reject a literal private IP without any DNS lookup', async () => {
    const lookup = jest.spyOn(dns.promises, 'lookup');

    const result = await guard.check('http://169.254.169.254/latest/meta-data/', OPEN);

    expect(result).toEqualLeft(expect.stringContaining(AGENT_REQUEST_HOST_BLOCKED));
    expect(lookup).not.toHaveBeenCalled();
  });

  it('should reject localhost by its resolved address', async () => {
    mockLookup([{ address: '127.0.0.1', family: 4 }]);

    const result = await guard.check('http://localhost:5432', OPEN);

    expect(E.isLeft(result)).toBe(true);
  });

  it('should reject a public hostname that resolves to a private address', async () => {
    // The DNS-rebinding shape: an innocuous name pointing inward.
    mockLookup([{ address: '127.0.0.1', family: 4 }]);

    const result = await guard.check('https://evil.example.com', OPEN);

    expect(result).toEqualLeft(expect.stringContaining('127.0.0.1'));
  });

  it('should reject when ANY resolved address is private', async () => {
    // An attacker can return several and control which is used later, so one
    // bad address poisons the whole set.
    mockLookup([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);

    const result = await guard.check('https://mixed.example.com', OPEN);

    expect(result).toEqualLeft(expect.stringContaining('10.0.0.5'));
  });

  it('should pin the resolved address so the caller cannot re-resolve', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);

    const result = await guard.check('https://example.com/api', OPEN);

    expect(E.isRight(result)).toBe(true);
    if (E.isRight(result)) {
      expect(result.right.address).toBe('93.184.216.34');
      expect(result.right.url.hostname).toBe('example.com');
    }
  });

  it('should enforce an allow-list when one is configured', async () => {
    mockLookup([{ address: '93.184.216.34', family: 4 }]);

    const blocked = await guard.check('https://other.com', {
      allowedHosts: ['api.example.com'],
    });
    expect(blocked).toEqualLeft(expect.stringContaining('not in the allowed hosts'));

    const allowed = await guard.check('https://api.example.com', {
      allowedHosts: ['api.example.com'],
    });
    expect(E.isRight(allowed)).toBe(true);
  });

  it('should still block a private address that the allow-list permits by name', async () => {
    mockLookup([{ address: '127.0.0.1', family: 4 }]);

    const result = await guard.check('https://internal.example.com', {
      allowedHosts: ['internal.example.com'],
    });

    // The allow-list narrows what is reachable; it never widens it.
    expect(E.isLeft(result)).toBe(true);
  });

  it('should reject a host that does not resolve', async () => {
    jest.spyOn(dns.promises, 'lookup').mockRejectedValue(new Error('ENOTFOUND'));

    const result = await guard.check('https://nope.invalid', OPEN);

    expect(result).toEqualLeft(expect.stringContaining('could not resolve'));
  });

  it('should reject a malformed URL', async () => {
    expect(E.isLeft(await guard.check('http://', OPEN))).toBe(true);
  });
});
