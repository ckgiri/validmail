import type { MxRecord, Resolver } from '../src/index';

type Answer<T> = T | string | (() => Promise<T>);

export interface Zone {
  mx?: Answer<MxRecord[]>;
  a?: Answer<string[]>;
  aaaa?: Answer<string[]>;
}

export function dnsError(code: string, host: string): Error {
  return Object.assign(new Error(`query ${code} ${host}`), { code, hostname: host });
}

/**
 * A fake resolver. Unknown domains answer ENOTFOUND; missing record types answer ENODATA;
 * a string answer is thrown as that DNS error code; a function answer is called.
 */
export function fakeResolver(zones: Record<string, Zone>, delayMs = 0) {
  const calls: string[] = [];
  const answer = async <T>(type: 'mx' | 'a' | 'aaaa', host: string): Promise<T> => {
    calls.push(`${type} ${host}`);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const zone = zones[host];
    if (!zone) throw dnsError('ENOTFOUND', host);
    const value = zone[type] as Answer<T> | undefined;
    if (value === undefined) throw dnsError('ENODATA', host);
    if (typeof value === 'string') throw dnsError(value, host);
    if (typeof value === 'function') return (value as () => Promise<T>)();
    return value;
  };
  const resolver: Resolver & { calls: string[] } = {
    calls,
    resolveMx: (h) => answer<MxRecord[]>('mx', h),
    resolve4: (h) => answer<string[]>('a', h),
    resolve6: (h) => answer<string[]>('aaaa', h),
  };
  return resolver;
}

export const zones: Record<string, Zone> = {
  'example.com': { mx: [{ exchange: 'mx2.example.com', priority: 20 }, { exchange: 'mx1.example.com', priority: 10 }] },
  'gmail.com': { mx: [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }] },
  'implicit.org': { a: ['192.0.2.10'] },
  'implicit6.org': { aaaa: ['2001:db8::1'] },
  'nomail.net': {},
  'nullmx.com': { mx: [{ exchange: '', priority: 0 }] },
  'nullmx-dot.com': { mx: [{ exchange: '.', priority: 0 }] },
  'servfail.com': { mx: 'ESERVFAIL' },
  'slowtimeout.com': { mx: 'ETIMEOUT' },
  'xn--bcher-kva.de': { mx: [{ exchange: 'mx.xn--bcher-kva.de.', priority: 10 }] },
  'mailinator.com': { mx: [{ exchange: 'mail.mailinator.com', priority: 10 }] },
};
