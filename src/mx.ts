import * as dns from 'node:dns/promises';
import { parseDomain } from './syntax';

/** An MX record: the mail server host name and its preference (lower is tried first). */
export interface MxRecord {
  exchange: string;
  priority: number;
}

/**
 * The DNS methods validmail uses. `dns.promises`, a `new dns.promises.Resolver()` (for custom
 * DNS servers) and plain objects (for tests) all fit. Errors should carry Node's DNS error
 * codes (`ENODATA`, `ENOTFOUND`, `ETIMEOUT`, ...) in `error.code`.
 */
export interface Resolver {
  resolveMx(hostname: string): Promise<MxRecord[]>;
  /** Used for the implicit MX fallback (RFC 5321 §5.1). Optional. */
  resolve4?(hostname: string): Promise<string[]>;
  /** Used for the implicit MX fallback (RFC 5321 §5.1). Optional. */
  resolve6?(hostname: string): Promise<string[]>;
}

/** Why the MX check failed or could not finish. */
export type MxReason = 'domain_not_found' | 'no_mx' | 'null_mx' | 'timeout' | 'dns_error';

/**
 * - `pass`: the domain can receive mail.
 * - `fail`: it definitely cannot (no such domain, no mail server, null MX).
 * - `error`: DNS did not answer in time or failed; the address may still be fine.
 * - `skip`: the check did not run.
 */
export type CheckStatus = 'pass' | 'fail' | 'skip' | 'error';

export interface MxCheck {
  status: CheckStatus;
  reason?: MxReason;
  message?: string;
  /** Mail servers sorted by priority. For an implicit MX this is the domain itself with priority 0. */
  records?: MxRecord[];
  /** No MX records, but the domain has an A/AAAA address, which RFC 5321 §5.1 treats as its mail server. */
  implicit?: boolean;
  /** The result came from the cache. */
  cached?: boolean;
  /** DNS error code, when `status` is `error`. */
  code?: string;
}

export interface MxCacheEntry {
  expires: number;
  value: MxCheck;
}

export interface MxOptions {
  /** Milliseconds before the DNS check gives up with status `error` / reason `timeout`. `0` disables. Default `5000`. */
  timeout?: number;
  /** DNS resolver to use. Default: the system resolver (`node:dns/promises`). */
  resolver?: Resolver;
  /**
   * Cache DNS results per domain. `true` (default) uses a built-in in-memory cache per resolver,
   * `false` disables caching, or pass your own `Map` to control and share it.
   * Only definite answers (`pass`/`fail`) are cached; errors and timeouts are not.
   */
  cache?: boolean | Map<string, MxCacheEntry>;
  /** How long cached results stay fresh, in milliseconds. Default `3600000` (1 hour). */
  cacheTtl?: number;
  /** Accept domains without MX records that have an A/AAAA address (RFC 5321 §5.1). Default `true`. */
  implicitMx?: boolean;
  /** Abort the lookup. The promise rejects with `signal.reason`. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT = 5000;
const DEFAULT_TTL = 60 * 60 * 1000;
/** The built-in cache never holds more than this many domains; the oldest entries are dropped first. */
export const MAX_CACHE_ENTRIES = 10_000;

const systemResolver: Resolver = {
  resolveMx: (h) => dns.resolveMx(h),
  resolve4: (h) => dns.resolve4(h),
  resolve6: (h) => dns.resolve6(h),
};

let defaultCaches = new WeakMap<Resolver, Map<string, MxCacheEntry>>();
const inflight = new WeakMap<Resolver, Map<string, Promise<MxCheck>>>();

/** Empty the built-in DNS result caches. Caches you passed in with `cache: Map` are not touched. */
export function clearCache(): void {
  defaultCaches = new WeakMap();
}

function getCache(option: MxOptions['cache'], resolver: Resolver): Map<string, MxCacheEntry> | undefined {
  if (option === false) return undefined;
  if (option instanceof Map) return option;
  let cache = defaultCaches.get(resolver);
  if (!cache) defaultCaches.set(resolver, (cache = new Map()));
  return cache;
}

function errorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/** DNS answered "no such records" (domain exists, or does not exist). Anything else is a lookup failure. */
const NO_DATA = new Set(['ENODATA', 'ENOTFOUND', 'NXDOMAIN', 'ENONAME']);

function fail(reason: MxReason, domain: string, implicitMx = true): MxCheck {
  const messages: Record<string, string> = {
    domain_not_found: `The domain "${domain}" does not exist.`,
    no_mx: implicitMx
      ? `The domain "${domain}" has no mail server (no MX, A or AAAA records).`
      : `The domain "${domain}" has no MX records.`,
    null_mx: `The domain "${domain}" does not accept email (null MX record, RFC 7505).`,
  };
  return { status: 'fail', reason, message: messages[reason] };
}

function dnsError(e: unknown, domain: string): MxCheck {
  const code = errorCode(e);
  if (code === 'ETIMEOUT') {
    return { status: 'error', reason: 'timeout', code, message: `DNS lookup for "${domain}" timed out.` };
  }
  const detail = code ?? (e instanceof Error ? e.message : String(e));
  return { status: 'error', reason: 'dns_error', ...(code ? { code } : {}), message: `DNS lookup for "${domain}" failed: ${detail}.` };
}

function timeoutResult(domain: string, ms: number): MxCheck {
  return { status: 'error', reason: 'timeout', message: `DNS lookup for "${domain}" timed out after ${ms} ms.` };
}

function normalizeExchange(exchange: unknown): string {
  let e = typeof exchange === 'string' ? exchange.trim().toLowerCase() : '';
  while (e.endsWith('.')) e = e.slice(0, -1);
  return e;
}

async function lookup(resolver: Resolver, domain: string, implicitMx: boolean): Promise<MxCheck> {
  let raw: MxRecord[];
  try {
    raw = (await resolver.resolveMx(domain)) ?? [];
  } catch (e) {
    const code = errorCode(e);
    if (code === 'ENOTFOUND' || code === 'NXDOMAIN' || code === 'ENONAME') return fail('domain_not_found', domain);
    if (code !== 'ENODATA') return dnsError(e, domain);
    raw = [];
  }

  const records: MxRecord[] = [];
  for (const r of raw) {
    const exchange = normalizeExchange(r?.exchange);
    // RFC 7505 null MX: a single "0 ." record. Node reports the "." exchange as "".
    if (exchange !== '') records.push({ exchange, priority: Number(r.priority) || 0 });
  }
  if (raw.length > 0 && records.length === 0) return fail('null_mx', domain);
  if (records.length > 0) {
    records.sort((a, b) => a.priority - b.priority);
    return { status: 'pass', records };
  }
  if (!implicitMx) return fail('no_mx', domain, false);

  // RFC 5321 §5.1: no MX records means the domain itself is the mail server, if it has an address.
  const settled = await Promise.allSettled([
    resolver.resolve4 ? resolver.resolve4(domain) : Promise.resolve([]),
    resolver.resolve6 ? resolver.resolve6(domain) : Promise.resolve([]),
  ]);
  let failure: unknown;
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      if (Array.isArray(s.value) && s.value.length > 0) {
        return { status: 'pass', implicit: true, records: [{ exchange: domain, priority: 0 }] };
      }
    } else if (!NO_DATA.has(errorCode(s.reason) ?? '')) {
      failure ??= s.reason;
    }
  }
  return failure === undefined ? fail('no_mx', domain) : dnsError(failure, domain);
}

/** Resolve with `promise`, or with a timeout result, or reject when `signal` aborts. */
function race(promise: Promise<MxCheck>, domain: string, ms: number, signal: AbortSignal | undefined): Promise<MxCheck> {
  if (!(ms > 0 && ms < Infinity) && !signal) return promise;
  return new Promise<MxCheck>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      cleanup();
      reject(signal!.reason);
    };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (ms > 0 && ms < Infinity) {
      timer = setTimeout(() => {
        cleanup();
        resolve(timeoutResult(domain, ms));
      }, ms);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { cleanup(); resolve(v); },
      (e) => { cleanup(); reject(e); },
    );
  });
}

function copy(check: MxCheck, cached: boolean): MxCheck {
  const out: MxCheck = { ...check };
  if (check.records) out.records = check.records.map((r) => ({ ...r }));
  if (cached) out.cached = true;
  return out;
}

/** Look up an already-validated ASCII domain. */
export async function lookupMx(asciiDomain: string, options: MxOptions = {}): Promise<MxCheck> {
  const { signal } = options;
  signal?.throwIfAborted();
  const resolver = options.resolver ?? systemResolver;
  const implicitMx = options.implicitMx !== false;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const ttl = options.cacheTtl ?? DEFAULT_TTL;
  const key = implicitMx ? asciiDomain : `${asciiDomain} (no implicit mx)`;
  const cache = getCache(options.cache, resolver);

  const hit = cache?.get(key);
  if (hit) {
    if (hit.expires > Date.now()) return copy(hit.value, true);
    cache!.delete(key);
  }

  // Concurrent lookups of the same domain on the same resolver share one DNS query.
  let flights = inflight.get(resolver);
  if (!flights) inflight.set(resolver, (flights = new Map()));
  let flight = flights.get(key);
  if (!flight) {
    const started = race(
      lookup(resolver, asciiDomain, implicitMx).catch((e) => dnsError(e, asciiDomain)),
      asciiDomain,
      timeout,
      undefined,
    );
    const map = flights;
    flight = started.finally(() => {
      if (map.get(key) === flight) map.delete(key);
    });
    flights.set(key, flight);
  }

  const result = await race(flight, asciiDomain, timeout, signal);
  if (cache && (result.status === 'pass' || result.status === 'fail') && ttl > 0) {
    cache.delete(key);
    cache.set(key, { expires: Date.now() + ttl, value: copy(result, false) });
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  return copy(result, false);
}

/**
 * Check whether a domain can receive email: MX records, falling back to A/AAAA (implicit MX),
 * and detecting null MX (RFC 7505). Accepts a domain or a full address.
 * Throws a `TypeError` if the domain is not a syntactically valid host name.
 */
export async function checkMx(domainOrEmail: string, options: MxOptions = {}): Promise<MxCheck> {
  if (typeof domainOrEmail !== 'string') throw new TypeError('Expected a domain or email address string.');
  const s = domainOrEmail.trim();
  const parsed = parseDomain(s.slice(s.lastIndexOf('@') + 1), { requireTld: false });
  if (parsed.reason) throw new TypeError(`Invalid domain: "${s}"`);
  return lookupMx(parsed.asciiDomain, options);
}
