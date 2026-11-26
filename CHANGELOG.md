# Changelog

All notable changes to this package are documented here. This project follows [Semantic Versioning](https://semver.org/).

## 1.2.0 - Unreleased

Package metadata only. No code or behavior changes.
- Package metadata: author, funding link, homepage, repository and issue tracker in `package.json`, and the copyright holder in `LICENSE`.

## 1.0.0 - 2026-11-26

First release.

- `validmail(email, options?)` validates an address for server-side signups and resolves with `{ valid, reason, message, email, local, domain, asciiDomain, checks, mxRecords }`. Never rejects for bad input.
- Syntax check (RFC 5321/5322, practical subset): 64/254/63 length limits in octets, dot rules, `allowQuoted`, `allowIpLiteral` (IPv4 and `IPv6:`), `allowUnicodeLocal` (RFC 6531), `requireTld`. Unicode domains are converted to punycode with `domainToASCII` for DNS. Linear time, no backtracking regular expressions.
- Disposable domain check with ~590 built-in domains, subdomain-aware, plus `blockDomains` and `allowDomains`.
- Role accounts (`admin@`, `support@`, `noreply@`, ...) flagged in `checks.role`, rejected with `rejectRole`.
- MX check via `node:dns/promises`: A/AAAA fallback (implicit MX, RFC 5321 §5.1, `implicitMx`), null MX detection (RFC 7505), DNS errors reported as `status: 'error'` separately from definite failures, `allowDnsErrors`, `timeout`, `AbortSignal`.
- Injectable `resolver` for tests and custom DNS servers.
- In-memory domain cache with TTL (`cache: true | false | Map`, `cacheTtl`), bounded to 10,000 domains; concurrent lookups of the same domain share one query.
- `validateSync` / `validmail.sync`, `validateMany` with `concurrency`, `checkSyntax`, `checkMx`, `isValidEmail`, `isValidEmailAsync`, `isDisposable`, `isRoleAccount`, `disposableDomains`, `clearCache`.
- No SMTP probing, by design.
- ESM + CommonJS, TypeScript types with a result that narrows on `valid`, zero dependencies.
