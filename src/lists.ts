import { domainToASCII } from 'node:url';
import { disposableDomains } from './disposable-list';

const DISPOSABLE = new Set(disposableDomains);

// Shared mailboxes that usually belong to a team or a system rather than a person.
const ROLES = new Set(
  (
    'abuse accounting accounts admin administrator billing careers contact contactus customercare ' +
    'customerservice devnull dns enquiries enquiry feedback ftp hello help helpdesk hostmaster hr info ' +
    'inquiries inquiry investors jobs legal mail mailer-daemon marketing media newsletter no-reply ' +
    'no_reply noc noreply nobody null office orders postmaster press privacy recruiting root sales ' +
    'security service staff support sysadmin team tech undisclosed-recipients unsubscribe ' +
    'usenet uucp webmaster www'
  ).split(' '),
);

/** Lowercase, strip a leading `@` or `.`, and convert IDNs to punycode. */
export function normalizeDomain(input: string): string {
  let d = String(input).trim().toLowerCase();
  const at = d.lastIndexOf('@');
  if (at !== -1) d = d.slice(at + 1);
  while (d.startsWith('.')) d = d.slice(1);
  while (d.endsWith('.')) d = d.slice(0, -1);
  if (/[^\x00-\x7f]/.test(d) || d.includes('xn--')) d = domainToASCII(d) || d;
  return d;
}

const setCache = new WeakMap<object, { size: number; set: Set<string> }>();

function sizeOf(list: Iterable<string>): number {
  if (Array.isArray(list)) return list.length;
  if (list instanceof Set) return list.size;
  return -1;
}

/**
 * Turn a user-supplied list into a normalized Set. Arrays and Sets are memoized per object and
 * rebuilt when their length changes, so a large list (or one that grows) costs nothing per call.
 */
export function toDomainSet(list: Iterable<string> | undefined): Set<string> | undefined {
  if (!list) return undefined;
  if (typeof list === 'string') throw new TypeError('Expected an array or Set of domains, not a string.');
  const size = sizeOf(list);
  const hit = setCache.get(list);
  if (hit && hit.size === size) return hit.set;
  const set = new Set<string>();
  for (const d of list) {
    const n = normalizeDomain(d);
    if (n) set.add(n);
  }
  if (size !== -1) setCache.set(list, { size, set });
  return set;
}

/** Return the entry of `set` that `domain` equals or is a subdomain of. */
export function matchDomain(domain: string, set: ReadonlySet<string>): string | undefined {
  let d = domain;
  for (;;) {
    if (set.has(d)) return d;
    const dot = d.indexOf('.');
    if (dot === -1) return undefined;
    d = d.slice(dot + 1);
  }
}

/** Find the built-in disposable entry matching an ASCII domain. */
export function matchDisposable(asciiDomain: string): string | undefined {
  return matchDomain(asciiDomain, DISPOSABLE);
}

/**
 * True if the email address (or bare domain) belongs to a known disposable email service.
 * Subdomains match too: `x.mailinator.com` is disposable.
 */
export function isDisposable(emailOrDomain: string): boolean {
  if (typeof emailOrDomain !== 'string') return false;
  const d = normalizeDomain(emailOrDomain);
  return d !== '' && matchDisposable(d) !== undefined;
}

/** The role name for a local part (`Admin+x` → `admin`), or undefined. */
export function matchRole(local: string): string | undefined {
  let l = local.toLowerCase();
  const plus = l.indexOf('+');
  if (plus > 0) l = l.slice(0, plus);
  return ROLES.has(l) ? l : undefined;
}

/**
 * True if the address is a role account such as `admin@`, `support@` or `noreply@`.
 * Sub-addresses count: `info+news@example.com` is a role account.
 */
export function isRoleAccount(emailOrLocal: string): boolean {
  if (typeof emailOrLocal !== 'string') return false;
  const s = emailOrLocal.trim();
  const at = s.lastIndexOf('@');
  return matchRole(at === -1 ? s : s.slice(0, at)) !== undefined;
}
