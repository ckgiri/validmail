import { disposableDomains } from './disposable-list';
import { isDisposable, isRoleAccount, matchDisposable, matchDomain, matchRole, toDomainSet } from './lists';
import { checkMx, clearCache, lookupMx, type CheckStatus, type MxCheck, type MxOptions, type MxReason, type MxRecord } from './mx';
import { checkSyntax, type EmailParts, type Outcome, type SyntaxOptions, type SyntaxReason } from './syntax';

export { checkSyntax, checkMx, clearCache, isDisposable, isRoleAccount, disposableDomains };
export type {
  CheckStatus, MxCacheEntry, MxCheck, MxOptions, MxReason, MxRecord, Resolver,
} from './mx';
export type { EmailParts, Outcome, SyntaxOptions, SyntaxReason, SyntaxResult } from './syntax';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Why the disposable/blocklist check failed. */
export type DisposableReason = 'disposable' | 'blocked';

/** Every reason an address can be rejected, in the order the checks run. */
export type Reason = SyntaxReason | DisposableReason | 'role' | MxReason;

/** Options for the checks that run without DNS. */
export interface SyncOptions extends SyntaxOptions {
  /** Reject addresses at known disposable email services. Default `true`. */
  disposable?: boolean;
  /** Extra domains to reject (subdomains included). Always applied, even with `disposable: false`. */
  blockDomains?: Iterable<string>;
  /** Domains to exempt from the built-in disposable list (subdomains included). Does not override `blockDomains`. */
  allowDomains?: Iterable<string>;
  /** Reject role accounts such as `admin@`, `support@`, `noreply@`. Default `false` (they are only flagged). */
  rejectRole?: boolean;
}

export interface ValidmailOptions extends SyncOptions, MxOptions {
  /** Check that the domain can receive mail (MX, with A/AAAA fallback). Default `true`. */
  mx?: boolean;
  /**
   * When the DNS lookup times out or fails (SERVFAIL, network error), treat the address as valid
   * instead of invalid. `checks.mx.status` is still `'error'`. Default `false`.
   */
  allowDnsErrors?: boolean;
}

export interface ValidateManyOptions extends ValidmailOptions {
  /** Maximum number of addresses validated at the same time. Default `10`. */
  concurrency?: number;
}

export interface SyntaxCheck {
  status: 'pass' | 'fail';
  reason?: SyntaxReason;
  message?: string;
}

export interface DisposableCheck {
  status: 'pass' | 'fail' | 'skip';
  reason?: DisposableReason;
  message?: string;
  /** The domain is on the built-in disposable list (even if `allowDomains` exempts it or `disposable: false`). */
  isDisposable: boolean;
  /** The list entry that matched, e.g. `mailinator.com` for `x.mailinator.com`. */
  match?: string;
  /** Which list matched. */
  source?: 'builtin' | 'blockDomains' | 'allowDomains';
}

export interface RoleCheck {
  status: 'pass' | 'fail' | 'skip';
  reason?: 'role';
  message?: string;
  /** The address is a role account such as `admin@` or `support@`. */
  isRole: boolean;
  /** The normalized role name, e.g. `support`. */
  role?: string;
}

export interface Checks {
  syntax: SyntaxCheck;
  disposable: DisposableCheck;
  role: RoleCheck;
  mx: MxCheck;
}

/**
 * The result of `validmail()`. When `valid` is `false`, `reason` is the first failing check's
 * reason code and `message` explains it. Every check's own detail is in `checks`.
 */
export type ValidationResult = EmailParts & Outcome<Reason> & {
  checks: Checks;
  /** Mail servers sorted by priority, when the MX check passed. */
  mxRecords?: MxRecord[];
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface SyncState {
  parts: EmailParts;
  checks: Omit<Checks, 'mx'>;
  /** All sync checks passed, so DNS is worth asking. */
  ok: boolean;
}

function runSync(email: string, options: SyncOptions): SyncState {
  const syntax = checkSyntax(email, options);
  const { valid: _v, reason: _r, message: _m, ...parts } = syntax;
  const syntaxCheck: SyntaxCheck = syntax.valid
    ? { status: 'pass' }
    : { status: 'fail', reason: syntax.reason, message: syntax.message };
  if (!syntax.valid) {
    return {
      parts,
      checks: { syntax: syntaxCheck, disposable: { status: 'skip', isDisposable: false }, role: { status: 'skip', isRole: false } },
      ok: false,
    };
  }

  // Disposable / blocklist
  let disposable: DisposableCheck;
  if (parts.ipLiteral) {
    disposable = { status: 'skip', isDisposable: false };
  } else {
    const domain = parts.asciiDomain;
    const builtin = matchDisposable(domain);
    const blocked = matchDomain(domain, toDomainSet(options.blockDomains) ?? EMPTY);
    const allowed = matchDomain(domain, toDomainSet(options.allowDomains) ?? EMPTY);
    if (blocked) {
      disposable = { status: 'fail', reason: 'blocked', message: `The domain "${parts.domain}" is not allowed.`, isDisposable: !!builtin, match: blocked, source: 'blockDomains' };
    } else if (builtin && options.disposable !== false && !allowed) {
      disposable = { status: 'fail', reason: 'disposable', message: `"${parts.domain}" is a disposable email service.`, isDisposable: true, match: builtin, source: 'builtin' };
    } else if (builtin && allowed) {
      disposable = { status: 'pass', isDisposable: true, match: allowed, source: 'allowDomains' };
    } else {
      disposable = builtin ? { status: 'pass', isDisposable: true, match: builtin, source: 'builtin' } : { status: 'pass', isDisposable: false };
    }
  }

  // Role account
  const roleName = parts.quoted ? undefined : matchRole(parts.local);
  const role: RoleCheck = roleName
    ? options.rejectRole
      ? { status: 'fail', reason: 'role', message: `"${parts.local}" is a role account, not a personal address.`, isRole: true, role: roleName }
      : { status: 'pass', isRole: true, role: roleName }
    : { status: 'pass', isRole: false };

  return {
    parts,
    checks: { syntax: syntaxCheck, disposable, role },
    ok: disposable.status !== 'fail' && role.status !== 'fail',
  };
}

const EMPTY: ReadonlySet<string> = new Set();

function finish(state: SyncState, mx: MxCheck, allowDnsErrors: boolean | undefined): ValidationResult {
  const checks: Checks = { ...state.checks, mx };
  const order = [checks.syntax, checks.disposable, checks.role, checks.mx] as const;
  for (const check of order) {
    if (check.status === 'fail' || (check.status === 'error' && !allowDnsErrors)) {
      return { valid: false, reason: check.reason!, message: check.message!, ...state.parts, checks };
    }
  }
  const result: ValidationResult = { valid: true, ...state.parts, checks };
  if (mx.status === 'pass' && mx.records) result.mxRecords = mx.records;
  return result;
}

/**
 * Validate an email address without DNS: syntax, disposable domains, blocklist and role accounts.
 * `checks.mx.status` is always `'skip'`.
 */
export function validateSync(email: string, options: SyncOptions = {}): ValidationResult {
  return finish(runSync(email, options), { status: 'skip' }, false);
}

/**
 * Validate an email address: syntax, disposable domains, role accounts, then DNS (MX, with
 * A/AAAA fallback and null MX detection). Resolves with a detailed result; never rejects for
 * a bad address. Rejects only if `options.signal` aborts.
 */
export async function validate(email: string, options: ValidmailOptions = {}): Promise<ValidationResult> {
  options.signal?.throwIfAborted();
  const state = runSync(email, options);
  let mx: MxCheck = { status: 'skip' };
  if (state.ok && options.mx !== false && !state.parts.ipLiteral) {
    mx = await lookupMx(state.parts.asciiDomain, options);
  }
  return finish(state, mx, options.allowDnsErrors);
}

/** `true` if the address passes the checks that need no DNS (see `validateSync`). */
export function isValidEmail(email: string, options?: SyncOptions): boolean {
  return validateSync(email, options).valid;
}

/** `true` if the address passes every check, including DNS (see `validate`). */
export async function isValidEmailAsync(email: string, options?: ValidmailOptions): Promise<boolean> {
  return (await validate(email, options)).valid;
}

/**
 * Validate many addresses with limited concurrency. Results are in input order. Addresses on
 * the same domain share one DNS lookup.
 */
export async function validateMany(emails: Iterable<string>, options: ValidateManyOptions = {}): Promise<ValidationResult[]> {
  const list = Array.from(emails);
  const concurrency = options.concurrency ?? 10;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(`concurrency must be a positive integer, got ${String(concurrency)}`);
  }
  options.signal?.throwIfAborted();
  const results = new Array<ValidationResult>(list.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < list.length) {
      const i = next++;
      results[i] = await validate(list[i]!, options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Default export: await validmail('user@example.com')
// ---------------------------------------------------------------------------

export interface Validmail {
  /** Validate an email address, including DNS. Same as `validate`. */
  (email: string, options?: ValidmailOptions): Promise<ValidationResult>;
  validate: typeof validate;
  sync: typeof validateSync;
  validateSync: typeof validateSync;
  validateMany: typeof validateMany;
  checkSyntax: typeof checkSyntax;
  checkMx: typeof checkMx;
  isValidEmail: typeof isValidEmail;
  isValidEmailAsync: typeof isValidEmailAsync;
  isDisposable: typeof isDisposable;
  isRoleAccount: typeof isRoleAccount;
  clearCache: typeof clearCache;
  disposableDomains: typeof disposableDomains;
}

const validmail = ((email: string, options?: ValidmailOptions) => validate(email, options)) as Validmail;

Object.assign(validmail, {
  validate,
  sync: validateSync,
  validateSync,
  validateMany,
  checkSyntax,
  checkMx,
  isValidEmail,
  isValidEmailAsync,
  isDisposable,
  isRoleAccount,
  clearCache,
  disposableDomains,
});

export default validmail;
