import { Injectable } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';
import * as E from 'fp-ts/Either';
import { AGENT_REQUEST_HOST_BLOCKED } from 'src/errors';

/**
 * Egress policy for agent-initiated outbound HTTP.
 *
 * This is the only place the backend makes arbitrary outbound requests, and it
 * can be driven by an authenticated user or by a prompt-injected model reading
 * an attacker-controlled spec. DEPLOY.md deliberately binds the container to
 * 127.0.0.1 and exposes nothing but Caddy - a naive fetch would punch straight
 * through that to Postgres, the container network, and cloud metadata.
 */
export type EgressPolicy = {
  allowedHosts: string[];
};

export type ResolvedTarget = {
  url: URL;
  /** The specific IP we resolved and will connect to. */
  address: string;
  family: number;
};

/** IPv4 ranges that must never be reachable from an agent request. */
const BLOCKED_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. 169.254.169.254 cloud metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0];

  if (lower === '::' || lower === '::1') return true;
  // Unique local (fc00::/7) and link-local (fe80::/10)
  if (/^f[cd]/.test(lower)) return true;
  if (/^fe[89ab]/.test(lower)) return true;

  // IPv4-mapped (::ffff:a.b.c.d) must be judged by its IPv4 rules.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  return false;
}

export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (net.isIPv6(ip)) return isBlockedIPv6(ip);
  // Unparseable - refuse rather than guess.
  return true;
}

/** Match a host against an allow-list entry, supporting a single `*.` prefix. */
export function matchesHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().split(':')[0];

  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

@Injectable()
export class SsrfGuardService {
  /**
   * Validate a URL and pin it to a concrete IP.
   *
   * Returning the resolved address matters: checking the hostname and then
   * letting fetch re-resolve is a TOCTOU hole that DNS rebinding walks
   * straight through. Callers must connect to `address`, not re-resolve.
   */
  async check(
    rawUrl: string,
    policy: EgressPolicy,
  ): Promise<E.Either<string, ResolvedTarget>> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return E.left(`${AGENT_REQUEST_HOST_BLOCKED}: malformed URL`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return E.left(
        `${AGENT_REQUEST_HOST_BLOCKED}: only http and https are allowed`,
      );
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');

    // An explicit allow-list turns this from a deny-list into an allow-list,
    // which is what we recommend admins run in production.
    if (policy.allowedHosts.length > 0) {
      const allowed = policy.allowedHosts.some((pattern) =>
        matchesHostPattern(host, pattern),
      );
      if (!allowed) {
        return E.left(
          `${AGENT_REQUEST_HOST_BLOCKED}: ${host} is not in the allowed hosts list`,
        );
      }
    }

    // A literal IP needs no resolution, but still has to pass the range check.
    if (net.isIP(host)) {
      if (isBlockedAddress(host)) {
        return E.left(
          `${AGENT_REQUEST_HOST_BLOCKED}: ${host} is a private or reserved address`,
        );
      }
      return E.right({
        url,
        address: host,
        family: net.isIPv6(host) ? 6 : 4,
      });
    }

    let records: dns.LookupAddress[];
    try {
      records = await dns.promises.lookup(host, { all: true });
    } catch {
      return E.left(`${AGENT_REQUEST_HOST_BLOCKED}: could not resolve ${host}`);
    }

    if (records.length === 0) {
      return E.left(`${AGENT_REQUEST_HOST_BLOCKED}: could not resolve ${host}`);
    }

    // Reject if ANY resolved address is private: a rebinding attacker can
    // return several and pick which one gets used on a later resolution.
    const blocked = records.find((record) => isBlockedAddress(record.address));
    if (blocked) {
      return E.left(
        `${AGENT_REQUEST_HOST_BLOCKED}: ${host} resolves to the private or reserved address ${blocked.address}`,
      );
    }

    return E.right({
      url,
      address: records[0].address,
      family: records[0].family,
    });
  }
}
