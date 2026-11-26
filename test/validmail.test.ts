import { promises as dnsPromises } from 'node:dns';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import validmail, {
  checkMx, clearCache, isValidEmailAsync, validate, validateMany, validateSync,
  type MxCacheEntry, type Reason, type Resolver, type ValidationResult,
} from '../src/index';
import { fakeResolver, zones } from './helpers';

afterEach(() => clearCache());

describe('validmail()', () => {
  it('passes a deliverable address with sorted MX records', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('  Jane.Doe@Example.COM ', { resolver });
    expect(r).toMatchObject({ valid: true, email: 'Jane.Doe@example.com', local: 'Jane.Doe', domain: 'example.com', asciiDomain: 'example.com' });
    expect(r.reason).toBeUndefined();
    expect(r.mxRecords).toEqual([
      { exchange: 'mx1.example.com', priority: 10 },
      { exchange: 'mx2.example.com', priority: 20 },
    ]);
    expect(r.checks).toEqual({
      syntax: { status: 'pass' },
      disposable: { status: 'pass', isDisposable: false },
      role: { status: 'pass', isRole: false },
      mx: { status: 'pass', records: r.mxRecords },
    });
    expect(resolver.calls).toEqual(['mx example.com']);
  });

  it('is the same function as validate and exposes helpers', async () => {
    expect(typeof validmail.sync).toBe('function');
    expect(validmail.validate).toBe(validate);
    expect(validmail.sync).toBe(validateSync);
    expect(validmail.validateMany).toBe(validateMany);
    expect(validmail.checkMx).toBe(checkMx);
    expect(Array.isArray(validmail.disposableDomains)).toBe(true);
  });

  it('falls back to A/AAAA records (implicit MX, RFC 5321 §5.1)', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('user@implicit.org', { resolver });
    expect(r.valid).toBe(true);
    expect(r.checks.mx).toEqual({ status: 'pass', implicit: true, records: [{ exchange: 'implicit.org', priority: 0 }] });
    expect((await validmail('user@implicit6.org', { resolver })).valid).toBe(true);
    expect(resolver.calls).toContain('a implicit.org');
    expect(resolver.calls).toContain('aaaa implicit.org');
  });

  it('implicitMx: false requires real MX records', async () => {
    const r = await validmail('user@implicit.org', { resolver: fakeResolver(zones), implicitMx: false });
    expect(r).toMatchObject({ valid: false, reason: 'no_mx' });
    expect(r.message).toContain('no MX records');
  });

  it('rejects domains with no mail server', async () => {
    const r = await validmail('user@nomail.net', { resolver: fakeResolver(zones) });
    expect(r).toMatchObject({ valid: false, reason: 'no_mx' });
    expect(r.checks.mx.status).toBe('fail');
  });

  it('rejects domains that do not exist', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('user@does-not-exist.example', { resolver });
    expect(r).toMatchObject({ valid: false, reason: 'domain_not_found' });
    expect(r.message).toContain('does-not-exist.example');
    expect(resolver.calls).toEqual(['mx does-not-exist.example']); // no pointless A/AAAA queries
  });

  it('detects null MX (RFC 7505) in both "" and "." forms', async () => {
    const resolver = fakeResolver(zones);
    for (const d of ['nullmx.com', 'nullmx-dot.com']) {
      const r = await validmail(`user@${d}`, { resolver });
      expect(r).toMatchObject({ valid: false, reason: 'null_mx' });
      expect(r.message).toContain('RFC 7505');
    }
    expect(resolver.calls.some((c) => c.startsWith('a '))).toBe(false);
  });

  it('ignores a null MX mixed with real ones', async () => {
    const resolver = fakeResolver({ 'mixed.com': { mx: [{ exchange: '', priority: 0 }, { exchange: 'MX.Mixed.com.', priority: 5 }] } });
    const r = await validmail('user@mixed.com', { resolver });
    expect(r.mxRecords).toEqual([{ exchange: 'mx.mixed.com', priority: 5 }]);
  });

  it('treats DNS failures as errors, invalid by default', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('user@servfail.com', { resolver });
    expect(r).toMatchObject({ valid: false, reason: 'dns_error' });
    expect(r.checks.mx).toMatchObject({ status: 'error', reason: 'dns_error', code: 'ESERVFAIL' });

    const t = await validmail('user@slowtimeout.com', { resolver });
    expect(t).toMatchObject({ valid: false, reason: 'timeout' });
    expect(t.checks.mx).toMatchObject({ status: 'error', code: 'ETIMEOUT' });
  });

  it('allowDnsErrors: true accepts addresses when DNS fails', async () => {
    const r = await validmail('user@servfail.com', { resolver: fakeResolver(zones), allowDnsErrors: true });
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.checks.mx.status).toBe('error');
    expect(r.mxRecords).toBeUndefined();
  });

  it('reports an error when A/AAAA fallback fails transiently', async () => {
    const resolver = fakeResolver({ 'flaky.org': { a: 'ESERVFAIL' } });
    expect((await validmail('user@flaky.org', { resolver })).checks.mx).toMatchObject({ status: 'error', reason: 'dns_error' });
    const ok = fakeResolver({ 'half.org': { a: 'ESERVFAIL', aaaa: ['2001:db8::2'] } });
    expect((await validmail('user@half.org', { resolver: ok })).valid).toBe(true);
  });

  it('handles resolvers that throw plain errors or return nothing', async () => {
    const throwing: Resolver = { resolveMx: async () => { throw new Error('boom'); } };
    const r = await validmail('user@example.com', { resolver: throwing, cache: false });
    expect(r.checks.mx).toMatchObject({ status: 'error', reason: 'dns_error' });
    expect(r.message).toContain('boom');

    const sync: Resolver = { resolveMx: () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); } };
    expect((await validmail('user@example.com', { resolver: sync, cache: false })).reason).toBe('domain_not_found');

    const empty: Resolver = { resolveMx: async () => [] };
    expect((await validmail('user@example.com', { resolver: empty, cache: false })).reason).toBe('no_mx');
  });

  it('queries DNS with the punycode domain and normalizes exchanges', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('user@Bücher.de', { resolver });
    expect(r).toMatchObject({ valid: true, email: 'user@bücher.de', asciiDomain: 'xn--bcher-kva.de' });
    expect(r.mxRecords).toEqual([{ exchange: 'mx.xn--bcher-kva.de', priority: 10 }]);
    expect(resolver.calls).toEqual(['mx xn--bcher-kva.de']);
  });

  it('skips DNS when an earlier check fails', async () => {
    const resolver = fakeResolver(zones);
    const bad = await validmail('not-an-email', { resolver });
    expect(bad).toMatchObject({ valid: false, reason: 'missing_at' });
    expect(bad.checks).toMatchObject({ syntax: { status: 'fail', reason: 'missing_at' }, disposable: { status: 'skip' }, role: { status: 'skip' }, mx: { status: 'skip' } });

    expect((await validmail('a@mailinator.com', { resolver })).reason).toBe('disposable');
    expect((await validmail('admin@example.com', { resolver, rejectRole: true })).reason).toBe('role');
    expect(resolver.calls).toEqual([]);
  });

  it('mx: false skips DNS', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('user@nomail.net', { resolver, mx: false });
    expect(r.valid).toBe(true);
    expect(r.checks.mx).toEqual({ status: 'skip' });
    expect(resolver.calls).toEqual([]);
  });

  it('skips DNS for IP literals', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('user@[192.0.2.1]', { resolver, allowIpLiteral: true });
    expect(r).toMatchObject({ valid: true, ipLiteral: true });
    expect(r.checks.mx.status).toBe('skip');
    expect(r.checks.disposable.status).toBe('skip');
    expect(resolver.calls).toEqual([]);
  });

  it('never rejects for bad input', async () => {
    const r = await validmail(undefined as unknown as string, { resolver: fakeResolver(zones) });
    expect(r).toMatchObject({ valid: false, reason: 'invalid_type' });
  });
});

describe('timeout', () => {
  it('gives up after `timeout` ms with reason "timeout"', async () => {
    const hanging: Resolver = { resolveMx: () => new Promise(() => {}) };
    const start = Date.now();
    const r = await validmail('user@example.com', { resolver: hanging, timeout: 50 });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(r).toMatchObject({ valid: false, reason: 'timeout' });
    expect(r.checks.mx).toMatchObject({ status: 'error', reason: 'timeout' });
    expect(r.message).toContain('50 ms');
  });

  it('covers the A/AAAA fallback too', async () => {
    const resolver = fakeResolver({ 'slow.org': { a: () => new Promise(() => {}) } });
    const r = await validmail('user@slow.org', { resolver, timeout: 30 });
    expect(r.reason).toBe('timeout');
  });

  it('timeouts are not cached', async () => {
    let calls = 0;
    const resolver: Resolver = {
      resolveMx: () => (++calls === 1 ? new Promise(() => {}) : Promise.resolve([{ exchange: 'mx.example.com', priority: 1 }])),
    };
    expect((await validmail('a@example.com', { resolver, timeout: 20 })).reason).toBe('timeout');
    expect((await validmail('a@example.com', { resolver, timeout: 20 })).valid).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('cache', () => {
  it('caches per domain by default', async () => {
    const resolver = fakeResolver(zones);
    const first = await validmail('a@example.com', { resolver });
    const second = await validmail('b@Example.com', { resolver });
    expect(first.checks.mx.cached).toBeUndefined();
    expect(second.checks.mx.cached).toBe(true);
    expect(second.mxRecords).toEqual(first.mxRecords);
    expect(resolver.calls).toEqual(['mx example.com']);
  });

  it('caches failures too', async () => {
    const resolver = fakeResolver(zones);
    await validmail('a@nomail.net', { resolver });
    const again = await validmail('b@nomail.net', { resolver });
    expect(again).toMatchObject({ valid: false, reason: 'no_mx' });
    expect(resolver.calls.filter((c) => c.startsWith('mx'))).toHaveLength(1);
  });

  it('does not cache DNS errors', async () => {
    const resolver = fakeResolver(zones);
    await validmail('a@servfail.com', { resolver });
    await validmail('a@servfail.com', { resolver });
    expect(resolver.calls).toEqual(['mx servfail.com', 'mx servfail.com']);
  });

  it('cache: false disables it', async () => {
    const resolver = fakeResolver(zones);
    await validmail('a@example.com', { resolver, cache: false });
    await validmail('a@example.com', { resolver, cache: false });
    expect(resolver.calls).toHaveLength(2);
  });

  it('accepts your own Map', async () => {
    const cache = new Map<string, MxCacheEntry>();
    const resolver = fakeResolver(zones);
    await validmail('a@example.com', { resolver, cache });
    expect([...cache.keys()]).toEqual(['example.com']);
    expect(cache.get('example.com')!.value.status).toBe('pass');
    // A different resolver sharing the Map gets the cached answer.
    const other = fakeResolver({});
    expect((await validmail('a@example.com', { resolver: other, cache })).valid).toBe(true);
    expect(other.calls).toEqual([]);
  });

  it('keeps the built-in cache separate per resolver', async () => {
    const a = fakeResolver(zones);
    const b = fakeResolver({});
    expect((await validmail('x@example.com', { resolver: a })).valid).toBe(true);
    expect((await validmail('x@example.com', { resolver: b })).reason).toBe('domain_not_found');
  });

  it('expires entries after cacheTtl', async () => {
    const resolver = fakeResolver(zones);
    const cache = new Map<string, MxCacheEntry>();
    await validmail('a@example.com', { resolver, cache, cacheTtl: 10 });
    await new Promise((r) => setTimeout(r, 25));
    const r = await validmail('a@example.com', { resolver, cache, cacheTtl: 10 });
    expect(r.checks.mx.cached).toBeUndefined();
    expect(resolver.calls).toHaveLength(2);
  });

  it('clearCache() empties the built-in cache', async () => {
    const resolver = fakeResolver(zones);
    await validmail('a@example.com', { resolver });
    clearCache();
    await validmail('a@example.com', { resolver });
    expect(resolver.calls).toHaveLength(2);
  });

  it('returned records cannot corrupt the cache', async () => {
    const resolver = fakeResolver(zones);
    const r = await validmail('a@example.com', { resolver });
    r.mxRecords![0]!.exchange = 'evil.example';
    const again = await validmail('a@example.com', { resolver });
    expect(again.mxRecords![0]!.exchange).toBe('mx1.example.com');
  });

  it('is bounded (oldest entries dropped first)', async () => {
    const cache = new Map<string, MxCacheEntry>();
    for (let i = 0; i < 10_000; i++) cache.set(`d${i}.test`, { expires: Date.now() + 60_000, value: { status: 'fail', reason: 'no_mx' } });
    await validmail('a@example.com', { resolver: fakeResolver(zones), cache });
    expect(cache.size).toBe(10_000);
    expect(cache.has('d0.test')).toBe(false);
    expect(cache.has('example.com')).toBe(true);
  });
});

describe('in-flight deduplication', () => {
  it('shares one DNS query between concurrent lookups of the same domain', async () => {
    const resolver = fakeResolver(zones, 20);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => validmail(`user${i}@example.com`, { resolver, cache: false })),
    );
    expect(results.every((r) => r.valid)).toBe(true);
    expect(resolver.calls).toEqual(['mx example.com']);
    // Each caller gets its own copy.
    expect(results[0]!.mxRecords).not.toBe(results[1]!.mxRecords);
  });

  it('shares errors between concurrent callers but does not keep them', async () => {
    const resolver = fakeResolver(zones, 10);
    const rs = await Promise.all([validmail('a@servfail.com', { resolver }), validmail('b@servfail.com', { resolver })]);
    expect(rs.map((r) => r.reason)).toEqual(['dns_error', 'dns_error']);
    await validmail('c@servfail.com', { resolver });
    expect(resolver.calls).toEqual(['mx servfail.com', 'mx servfail.com']);
  });
});

describe('AbortSignal', () => {
  it('rejects immediately when already aborted', async () => {
    const resolver = fakeResolver(zones);
    await expect(validmail('a@example.com', { resolver, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(resolver.calls).toEqual([]);
  });

  it('rejects with the abort reason mid-lookup without disturbing other callers', async () => {
    const resolver = fakeResolver(zones, 50);
    const controller = new AbortController();
    const aborted = validmail('a@example.com', { resolver, signal: controller.signal });
    const other = validmail('b@example.com', { resolver });
    setTimeout(() => controller.abort(new Error('user left')), 5);
    await expect(aborted).rejects.toThrow('user left');
    expect((await other).valid).toBe(true);
    expect(resolver.calls).toEqual(['mx example.com']);
  });

  it('works with AbortSignal.timeout()', async () => {
    const hanging: Resolver = { resolveMx: () => new Promise(() => {}) };
    await expect(validmail('a@example.com', { resolver: hanging, timeout: 0, signal: AbortSignal.timeout(20) })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('validateMany', () => {
  it('returns results in input order', async () => {
    const resolver = fakeResolver(zones, 5);
    const emails = ['a@example.com', 'bad', 'b@mailinator.com', 'c@nomail.net', 'd@gmail.com'];
    const rs = await validateMany(emails, { resolver });
    expect(rs.map((r) => r.valid)).toEqual([true, false, false, false, true]);
    expect(rs.map((r) => r.reason)).toEqual([undefined, 'missing_at', 'disposable', 'no_mx', undefined]);
  });

  it('respects concurrency', async () => {
    let active = 0;
    let peak = 0;
    const resolver: Resolver = {
      resolveMx: async (h) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return [{ exchange: `mx.${h}`, priority: 1 }];
      },
    };
    const emails = Array.from({ length: 30 }, (_, i) => `u@d${i}.com`);
    const rs = await validateMany(emails, { resolver, concurrency: 3 });
    expect(rs).toHaveLength(30);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('looks each domain up once', async () => {
    const resolver = fakeResolver(zones, 5);
    await validateMany(Array.from({ length: 20 }, (_, i) => `user${i}@gmail.com`), { resolver });
    expect(resolver.calls).toEqual(['mx gmail.com']);
  });

  it('accepts any iterable and an empty list', async () => {
    expect(await validateMany(new Set<string>())).toEqual([]);
    const rs = await validateMany(new Set(['x@example.com']), { resolver: fakeResolver(zones) });
    expect(rs[0]!.valid).toBe(true);
  });

  it('validates concurrency', async () => {
    for (const c of [0, -1, 1.5, NaN]) {
      await expect(validateMany(['a@b.com'], { concurrency: c })).rejects.toThrow(RangeError);
    }
  });

  it('stops on abort', async () => {
    const resolver = fakeResolver(zones, 20);
    const controller = new AbortController();
    const p = validateMany(['a@example.com', 'b@gmail.com'], { resolver, signal: controller.signal, concurrency: 1 });
    setTimeout(() => controller.abort(), 5);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('isValidEmailAsync', () => {
  it('resolves to a boolean', async () => {
    const resolver = fakeResolver(zones);
    expect(await isValidEmailAsync('a@example.com', { resolver })).toBe(true);
    expect(await isValidEmailAsync('a@nomail.net', { resolver })).toBe(false);
  });
});

describe('checkMx', () => {
  it('accepts a domain or an address', async () => {
    const resolver = fakeResolver(zones);
    expect((await checkMx('gmail.com', { resolver })).status).toBe('pass');
    expect((await checkMx('someone@Gmail.com', { resolver, cache: false })).records).toEqual([{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }]);
    expect(await checkMx('nullmx.com', { resolver })).toMatchObject({ status: 'fail', reason: 'null_mx' });
    expect((await checkMx('bücher.de', { resolver })).status).toBe('pass');
  });

  it('throws on invalid domains', async () => {
    await expect(checkMx('not a domain')).rejects.toThrow(TypeError);
    await expect(checkMx(5 as unknown as string)).rejects.toThrow(TypeError);
  });
});

describe('real node:dns Resolver', () => {
  it('fits the Resolver type', () => {
    const r: Resolver = new dnsPromises.Resolver();
    const m: Resolver = dnsPromises;
    expect(typeof r.resolveMx).toBe('function');
    expect(typeof m.resolveMx).toBe('function');
  });

  it('reports an error (not a crash) when the DNS server is unreachable', async () => {
    // Loopback only: port 9 (discard) on 127.0.0.1 has no DNS server.
    const resolver = new dnsPromises.Resolver({ timeout: 100, tries: 1 });
    resolver.setServers(['127.0.0.1:9']);
    const r = await validmail('user@example.com', { resolver, timeout: 2000, cache: false });
    expect(r.valid).toBe(false);
    expect(r.checks.mx.status).toBe('error');
  });
});

describe('types', () => {
  it('narrows on valid', async () => {
    const r = await validmail('a@example.com', { resolver: fakeResolver(zones) });
    if (r.valid) {
      expectTypeOf(r.reason).toEqualTypeOf<undefined>();
    } else {
      expectTypeOf(r.reason).toEqualTypeOf<Reason>();
      expectTypeOf(r.message).toEqualTypeOf<string>();
    }
    expectTypeOf(validmail).returns.resolves.toEqualTypeOf<ValidationResult>();
    expectTypeOf(validmail.sync).returns.toEqualTypeOf<ValidationResult>();
  });
});
