import { isIPv4, isIPv6 } from 'node:net';
import { domainToASCII, domainToUnicode } from 'node:url';

/** Why an address failed the syntax check. */
export type SyntaxReason =
  | 'invalid_type'
  | 'empty'
  | 'too_long'
  | 'missing_at'
  | 'local_empty'
  | 'local_too_long'
  | 'local_invalid_char'
  | 'local_unicode'
  | 'local_dot'
  | 'quoted_not_allowed'
  | 'quoted_invalid'
  | 'domain_empty'
  | 'domain_too_long'
  | 'domain_label_too_long'
  | 'domain_invalid'
  | 'domain_no_tld'
  | 'tld_invalid'
  | 'ip_literal_not_allowed'
  | 'ip_literal_invalid';

export interface SyntaxOptions {
  /** Accept quoted local parts such as `"john doe"@example.com`. Default `false`. */
  allowQuoted?: boolean;
  /** Accept address literals such as `user@[192.0.2.1]` and `user@[IPv6:2001:db8::1]`. Default `false`. */
  allowIpLiteral?: boolean;
  /** Accept non-ASCII characters in the local part (RFC 6531, SMTPUTF8). Default `false`. Unicode domains are always accepted. */
  allowUnicodeLocal?: boolean;
  /** Require a dot in the domain (`user@localhost` fails). Default `true`. */
  requireTld?: boolean;
}

/** The parts of an address, normalized. Present on both valid and invalid results (best effort). */
export interface EmailParts {
  /** Normalized address: trimmed, domain lowercased (Unicode form for IDNs). */
  email: string;
  /** The part before the last `@`, unchanged (case is preserved). */
  local: string;
  /** Lowercased domain in Unicode form (`bücher.de`), or the bracketed literal for IP addresses. */
  domain: string;
  /** Domain in ASCII / punycode form (`xn--bcher-kva.de`), as used for DNS. Empty when the domain is invalid. */
  asciiDomain: string;
  /** The local part is a quoted string. */
  quoted: boolean;
  /** The domain is an address literal (`[192.0.2.1]`). */
  ipLiteral: boolean;
}

/** `valid: true` with no reason, or `valid: false` with a reason code and a readable message. */
export type Outcome<R extends string> =
  | { valid: true; reason?: undefined; message?: undefined }
  | { valid: false; reason: R; message: string };

export type SyntaxResult = EmailParts & Outcome<SyntaxReason>;

const MAX_EMAIL = 254; // RFC 5321 path limit (256) minus the angle brackets
const MAX_LOCAL = 64; // RFC 5321 §4.5.3.1.1
const MAX_DOMAIN = 253; // RFC 1035, without the trailing dot
const MAX_LABEL = 63; // RFC 1035

const SYNTAX_MESSAGES: Record<SyntaxReason, string> = {
  invalid_type: 'Email must be a string.',
  empty: 'Email is empty.',
  too_long: `Email is longer than ${MAX_EMAIL} characters.`,
  missing_at: 'Email must contain an "@".',
  local_empty: 'The part before "@" is empty.',
  local_too_long: `The part before "@" is longer than ${MAX_LOCAL} characters.`,
  local_invalid_char: 'The part before "@" contains a character that is not allowed',
  local_unicode: 'The part before "@" contains non-ASCII characters.',
  local_dot: 'The part before "@" cannot start or end with a dot or contain two dots in a row.',
  quoted_not_allowed: 'Quoted local parts ("john doe"@example.com) are not allowed.',
  quoted_invalid: 'The quoted part before "@" is malformed.',
  domain_empty: 'The domain after "@" is empty.',
  domain_too_long: `The domain is longer than ${MAX_DOMAIN} characters.`,
  domain_label_too_long: `A part of the domain is longer than ${MAX_LABEL} characters.`,
  domain_invalid: 'The domain is not a valid host name.',
  domain_no_tld: 'The domain has no top-level domain (like ".com").',
  tld_invalid: 'The top-level domain is not valid.',
  ip_literal_not_allowed: 'IP address domains (user@[192.0.2.1]) are not allowed.',
  ip_literal_invalid: 'The IP address literal is malformed.',
};

/** True for RFC 5322 `atext` in the ASCII range. */
function isAtext(c: number): boolean {
  return (
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    (c >= 48 && c <= 57) || // 0-9
    c === 33 || // !
    (c >= 35 && c <= 39) || // # $ % & '
    c === 42 || c === 43 || // * +
    c === 45 || c === 47 || // - /
    c === 61 || c === 63 || // = ?
    (c >= 94 && c <= 96) || // ^ _ `
    (c >= 123 && c <= 126) // { | } ~
  );
}

/** Non-ASCII code unit that may appear in an SMTPUTF8 local part (no C1 controls, no lone surrogates). */
function isUtf8Ok(s: string, i: number): 0 | 1 | 2 {
  const c = s.charCodeAt(i);
  if (c < 0xa0) return 0;
  if (c >= 0xd800 && c <= 0xdbff) {
    const n = s.charCodeAt(i + 1);
    return n >= 0xdc00 && n <= 0xdfff ? 2 : 0;
  }
  if (c >= 0xdc00 && c <= 0xdfff) return 0;
  return 1;
}

/** Number of UTF-8 octets in a string. */
function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function describeChar(s: string, i: number): string {
  const c = s.charCodeAt(i);
  if (c === 32) return 'a space';
  if (c < 32 || c === 127) return `control character U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  return `"${String.fromCodePoint(s.codePointAt(i)!)}"`;
}

type LocalProblem = { reason: SyntaxReason; detail?: string } | undefined;

function checkDotAtom(local: string, unicode: boolean): LocalProblem {
  if (local.charCodeAt(0) === 46 || local.charCodeAt(local.length - 1) === 46) return { reason: 'local_dot' };
  let prevDot = false;
  for (let i = 0; i < local.length; i++) {
    const c = local.charCodeAt(i);
    if (c === 46) {
      if (prevDot) return { reason: 'local_dot' };
      prevDot = true;
      continue;
    }
    prevDot = false;
    if (c < 128) {
      if (!isAtext(c)) return { reason: 'local_invalid_char', detail: describeChar(local, i) };
      continue;
    }
    if (!unicode) return { reason: 'local_unicode' };
    const w = isUtf8Ok(local, i);
    if (w === 0) return { reason: 'local_invalid_char', detail: describeChar(local, i) };
    i += w - 1;
  }
  return undefined;
}

/** RFC 5321 Quoted-string: DQUOTE *(qtextSMTP / quoted-pairSMTP) DQUOTE, at least one character inside. */
function checkQuoted(local: string, unicode: boolean): boolean {
  const end = local.length - 1;
  if (end < 2 || local.charCodeAt(end) !== 34) return false;
  for (let i = 1; i < end; i++) {
    const c = local.charCodeAt(i);
    if (c === 92) {
      // quoted-pair: backslash followed by printable ASCII or space
      i++;
      if (i >= end) return false;
      const n = local.charCodeAt(i);
      if (n < 32 || n > 126) return false;
    } else if (c === 34) {
      return false;
    } else if (c >= 32 && c <= 126) {
      continue;
    } else if (c >= 128 && unicode) {
      const w = isUtf8Ok(local, i);
      if (w === 0) return false;
      i += w - 1;
    } else {
      return false;
    }
  }
  return true;
}

function isAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) return false;
  return true;
}

export interface DomainParse {
  domain: string;
  asciiDomain: string;
  ipLiteral: boolean;
  reason?: SyntaxReason;
}

/** Validate an ASCII host name: LDH labels, lengths, TLD. */
function checkHostname(ascii: string, requireTld: boolean): SyntaxReason | undefined {
  if (ascii.length > MAX_DOMAIN) return 'domain_too_long';
  const labels = ascii.split('.');
  for (const label of labels) {
    if (label.length === 0) return 'domain_invalid';
    if (label.length > MAX_LABEL) return 'domain_label_too_long';
    if (label.charCodeAt(0) === 45 || label.charCodeAt(label.length - 1) === 45) return 'domain_invalid';
    for (let i = 0; i < label.length; i++) {
      const c = label.charCodeAt(i);
      if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) return 'domain_invalid';
    }
  }
  if (labels.length < 2 && requireTld) return 'domain_no_tld';
  const tld = labels[labels.length - 1]!;
  if (/^[0-9]+$/.test(tld)) return 'tld_invalid'; // all-numeric TLDs do not exist (RFC 3696 §2)
  if (labels.length > 1 && tld.length < 2) return 'tld_invalid';
  return undefined;
}

/** Parse and validate the part after `@`. */
export function parseDomain(raw: string, options: SyntaxOptions = {}): DomainParse {
  if (raw.length === 0) return { domain: '', asciiDomain: '', ipLiteral: false, reason: 'domain_empty' };

  // Address literal: [192.0.2.1] or [IPv6:2001:db8::1]
  if (raw.charCodeAt(0) === 91) {
    const fail = (reason: SyntaxReason): DomainParse => ({ domain: raw, asciiDomain: '', ipLiteral: true, reason });
    if (!options.allowIpLiteral) return fail('ip_literal_not_allowed');
    if (raw.charCodeAt(raw.length - 1) !== 93) return fail('ip_literal_invalid');
    const inner = raw.slice(1, -1);
    let literal: string;
    if (inner.slice(0, 5).toLowerCase() === 'ipv6:') {
      const addr = inner.slice(5);
      if (addr.includes('%') || !isIPv6(addr)) return fail('ip_literal_invalid');
      literal = `[IPv6:${addr.toLowerCase()}]`;
    } else if (isIPv4(inner)) {
      literal = `[${inner}]`;
    } else {
      return fail('ip_literal_invalid');
    }
    return { domain: literal, asciiDomain: literal, ipLiteral: true };
  }

  const lower = raw.toLowerCase();
  let ascii = lower;
  if (!isAscii(lower) || lower.includes('xn--')) {
    // Reject ASCII characters that are never valid in host names before handing the string to
    // domainToASCII, which would otherwise percent-decode (`%41`) or parse IPv4 shorthands (`0x7f.1`).
    for (let i = 0; i < lower.length; i++) {
      const c = lower.charCodeAt(i);
      if (c < 128 && !((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45 || c === 46)) {
        return { domain: lower, asciiDomain: '', ipLiteral: false, reason: 'domain_invalid' };
      }
    }
    ascii = domainToASCII(lower);
    if (!ascii) return { domain: lower, asciiDomain: '', ipLiteral: false, reason: 'domain_invalid' };
  }
  const reason = checkHostname(ascii, options.requireTld !== false);
  if (reason) return { domain: lower, asciiDomain: '', ipLiteral: false, reason };
  return { domain: ascii.includes('xn--') ? domainToUnicode(ascii) : ascii, asciiDomain: ascii, ipLiteral: false };
}

function result(parts: EmailParts, reason?: SyntaxReason, detail?: string): SyntaxResult {
  if (!reason) return { valid: true, ...parts };
  const base = SYNTAX_MESSAGES[reason];
  return { valid: false, reason, message: detail ? `${base}: ${detail}.` : base, ...parts };
}

/**
 * Check the syntax of an email address (RFC 5321/5322, practical subset). Never touches the network.
 *
 * Runs in linear time: there are no backtracking regular expressions, and input longer than
 * 254 characters is rejected before it is scanned.
 */
export function checkSyntax(email: string, options: SyntaxOptions = {}): SyntaxResult {
  const empty: EmailParts = { email: '', local: '', domain: '', asciiDomain: '', quoted: false, ipLiteral: false };
  if (typeof email !== 'string') return result(empty, 'invalid_type');
  // Cheap guard first so adversarial megabyte inputs cost nothing beyond the trim.
  const trimmed = email.trim();
  empty.email = trimmed.length > MAX_EMAIL ? trimmed.slice(0, MAX_EMAIL) : trimmed;
  if (trimmed.length === 0) return result(empty, 'empty');
  if (trimmed.length > MAX_EMAIL) return result(empty, 'too_long');

  const at = trimmed.lastIndexOf('@');
  if (at === -1) return result(empty, 'missing_at');
  const local = trimmed.slice(0, at);
  const rawDomain = trimmed.slice(at + 1);
  const quoted = local.charCodeAt(0) === 34;
  const parts: EmailParts = { email: trimmed, local, domain: rawDomain.toLowerCase(), asciiDomain: '', quoted, ipLiteral: false };

  if (local.length === 0) return result(parts, 'local_empty');
  const unicode = options.allowUnicodeLocal === true;
  if (quoted) {
    if (!options.allowQuoted) return result(parts, 'quoted_not_allowed');
    if (!checkQuoted(local, unicode)) return result(parts, 'quoted_invalid');
  } else {
    const problem = checkDotAtom(local, unicode);
    if (problem) return result(parts, problem.reason, problem.detail);
  }
  if (utf8Length(local) > MAX_LOCAL) return result(parts, 'local_too_long');

  const d = parseDomain(rawDomain, options);
  parts.domain = d.domain;
  parts.ipLiteral = d.ipLiteral;
  if (d.reason) return result(parts, d.reason);
  parts.asciiDomain = d.asciiDomain;
  parts.email = `${local}@${d.domain}`;
  if (utf8Length(local) + 1 + d.asciiDomain.length > MAX_EMAIL) {
    parts.asciiDomain = '';
    return result(parts, 'too_long');
  }
  return result(parts);
}
