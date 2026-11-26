# validmail

Check email addresses on the server: syntax, disposable domains and MX (DNS) records.

[![npm version](https://img.shields.io/npm/v/validmail.svg)](https://www.npmjs.com/package/validmail) [![bundle size](https://img.shields.io/bundlephobia/minzip/validmail)](https://bundlephobia.com/package/validmail) [![license](https://img.shields.io/npm/l/validmail.svg)](LICENSE)

validmail checks an email address before you save it, for example in a sign-up handler. It checks the format, blocks throwaway (disposable) email services, and asks DNS whether the domain can receive email. The result tells you which check failed and why. It runs in Node.js, Bun and Deno.

> **Validating in the browser?** Use [inboxok](https://www.npmjs.com/package/inboxok). It runs syntax, disposable and typo checks in forms, synchronously and without DNS. Use inboxok while the user types, and validmail on the server when the form is submitted.

## Features

- **Syntax check** that follows RFC 5321/5322 length limits (64/254/63) and dot rules.
- **Unicode domains** (`bücher.de`) converted to punycode, the ASCII form that DNS uses.
- **MX check** with A/AAAA fallback and **null MX** detection (a domain that says "no email here").
- **"No mail server" and "DNS timed out" are different results**, so a slow DNS server does not turn away real users.
- **~590 disposable domains** built in, subdomains included, plus your own block and allow lists.
- **Role accounts** (`admin@`, `support@`, `noreply@`) flagged, or rejected with `rejectRole`.
- **Built for servers**: timeouts, `AbortSignal`, a DNS cache, and `validateMany` with a concurrency limit.
- **Easy to test**: pass a fake DNS resolver, no network needed.
- **No SMTP probing**, no ReDoS (regular expressions that hang on bad input), zero dependencies, ~8 KB gzipped.

## Installation

```sh
npm install validmail
```

```sh
pnpm add validmail
yarn add validmail
bun add validmail
```

## Quick start

```js
import validmail from 'validmail'

const result = await validmail('Jane.Doe@Gmail.COM')
result.valid      // => true
result.email      // => 'Jane.Doe@gmail.com'  (domain lowercased)
result.mxRecords  // => [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }, ...]

await validmail('someone@mailinator.com') // => { valid: false, reason: 'disposable', ... }
await validmail('someone@gmial.con')      // => { valid: false, reason: 'domain_not_found', ... }
await validmail('someone@example.com')    // => { valid: false, reason: 'null_mx', ... }
await validmail('john..doe@example.com')  // => { valid: false, reason: 'local_dot', ... }

// Same checks without DNS, synchronous:
validmail.sync('someone@mailinator.com')  // => { valid: false, reason: 'disposable', ... }
```

CommonJS works too: `const validmail = require('validmail')`.

## Table of contents

- [Usage](#usage)
  - [Understand the checks](#understand-the-checks)
  - [Validate a sign-up on the server](#validate-a-sign-up-on-the-server)
  - [Check only the syntax (no DNS)](#check-only-the-syntax-no-dns)
  - [Validate a list of emails](#validate-a-list-of-emails)
  - [Block or allow more domains](#block-or-allow-more-domains)
  - [Reject role accounts](#reject-role-accounts)
  - [Use your own DNS servers](#use-your-own-dns-servers)
  - [Use a fake DNS resolver in tests](#use-a-fake-dns-resolver-in-tests)
  - [Cache DNS results](#cache-dns-results)
  - [Set a timeout or cancel a check](#set-a-timeout-or-cancel-a-check)
  - [Read the result](#read-the-result)
- [API](#api)
- [Comparison](#comparison)
- [Notes and limitations](#notes-and-limitations)
- [Requirements](#requirements)
- [License](#license)

## Usage

### Understand the checks

validmail runs four checks, in this order:

1. **Syntax**: is the address well-formed?
2. **Disposable**: is the domain a throwaway email service, or on your block list?
3. **Role**: is it a shared mailbox like `admin@` or `support@`? (Flagged only, unless you set `rejectRole`.)
4. **MX**: can the domain receive email?

If the syntax check fails, the other checks are skipped. DNS is only asked when all checks before it passed.

**What is MX?** MX (mail exchanger) records tell the internet which server receives email for a domain. If a domain has no MX records, it usually cannot receive email. Two details:

- A domain with no MX records but with an address (an A or AAAA record) is accepted. The email standard (RFC 5321 §5.1) says mail then goes to that address. This is called **implicit MX**. Set `implicitMx: false` to require real MX records.
- A domain can publish a **null MX** record (RFC 7505) to say "we never accept email". `example.com` does this. validmail rejects these addresses with `reason: 'null_mx'`.

### Validate a sign-up on the server

An Express route. Other frameworks work the same way.

```js
import express from 'express'
import validmail from 'validmail'

const app = express()
app.use(express.json())

app.post('/signup', async (req, res) => {
  const check = await validmail(req.body.email, { timeout: 3000, allowDnsErrors: true })
  if (!check.valid) {
    return res.status(422).json({ error: check.message, reason: check.reason })
  }
  await createUser({ email: check.email })  // save the normalized address
  await sendConfirmationEmail(check.email)  // the only real proof that the mailbox exists
  res.status(201).json({ ok: true })
})
```

- `allowDnsErrors: true` stops a DNS problem from turning away a real user. Definite failures (no such domain, no mail server, null MX) are still rejected.
- You do not need to check the input type first. A missing or non-string `email` gives `reason: 'invalid_type'`.
- `check.message` is a readable sentence, for example `"mailinator.com" is a disposable email service.`

### Check only the syntax (no DNS)

`validateSync` runs the syntax, disposable and role checks without DNS. `checkSyntax` runs only the syntax check. Both are synchronous and fast.

```js
import { validateSync, checkSyntax, isValidEmail } from 'validmail'

validateSync('someone@mailinator.com').reason  // => 'disposable'
isValidEmail('jane@example.com')               // => true  (no DNS, so null MX is not checked)
isValidEmail('jane doe@example.com')           // => false

const parts = checkSyntax('Jane@Bücher.DE')
parts.domain                                   // => 'bücher.de'
parts.asciiDomain                              // => 'xn--bcher-kva.de'

checkSyntax('user@localhost').reason                       // => 'domain_no_tld'
checkSyntax('user@localhost', { requireTld: false }).valid // => true
```

Without DNS you cannot know if the domain receives email. Run `validmail()` on the server before you save the address.

### Validate a list of emails

`validateMany` checks many addresses with a limit on how many run at the same time. Results come back in input order. Addresses on the same domain share one DNS lookup.

```js
import { validateMany } from 'validmail'

const emails = ['ann@gmail.com', 'bob@mailinator.com', 'carl@gmial.con']
const results = await validateMany(emails, { concurrency: 20, timeout: 3000 })

results.map((r) => r.valid)  // => [true, false, false]
results.filter((r) => !r.valid).map((r) => `${r.email}: ${r.reason}`)
// => ['bob@mailinator.com: disposable', 'carl@gmial.con: domain_not_found']
```

### Block or allow more domains

```js
import { validateSync } from 'validmail'

const options = {
  blockDomains: ['competitor.com', '@spam.example'], // extra domains to reject
  allowDomains: ['mailinator.com'],                  // exempt from the built-in disposable list
}

validateSync('ann@mail.competitor.com', options).reason // => 'blocked'
validateSync('qa@mailinator.com', options).valid        // => true
```

- Both lists include subdomains. A leading `@` or `.` is ignored, and Unicode domains are fine.
- `blockDomains` always wins over `allowDomains`, and it applies even with `disposable: false`.
- `disposable: false` turns off the built-in list. Disposable domains are then only flagged in `checks.disposable.isDisposable`.

Need a bigger disposable list? Pass the list from [mailchecker](https://www.npmjs.com/package/mailchecker) as `blockDomains`. validmail prepares each list object once and then reuses it:

```js
import mailchecker from 'mailchecker'

const blockDomains = mailchecker.blacklist() // Set of ~56,000 domains
await validmail(email, { blockDomains })
```

### Reject role accounts

Role accounts are shared mailboxes such as `admin@`, `info@`, `support@` and `noreply@`. By default they pass and are only flagged. Case and `+tags` are ignored.

```js
import { validateSync } from 'validmail'

validateSync('Support+billing@acme.com').checks.role
// => { status: 'pass', isRole: true, role: 'support' }

validateSync('support@acme.com', { rejectRole: true }).reason // => 'role'
```

### Use your own DNS servers

Pass any `resolver` object with a `resolveMx` method. Node's `dns.promises.Resolver` lets you pick the DNS servers and their own timeout and retry settings.

```js
import { promises as dns } from 'node:dns'
import validmail from 'validmail'

const resolver = new dns.Resolver({ timeout: 2000, tries: 2 })
resolver.setServers(['1.1.1.1', '8.8.8.8'])

await validmail('ann@gmail.com', { resolver }) // => { valid: true, ... }
```

Each resolver object gets its own built-in cache. Create the resolver once and reuse it.

### Use a fake DNS resolver in tests

A plain object works as a resolver, so your tests need no network.

```js
import validmail from 'validmail'

const resolver = {
  async resolveMx(host) {
    if (host === 'example.com') return [{ exchange: 'mx.example.com', priority: 10 }]
    throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' })
  },
}

const found = await validmail('a@example.com', { resolver })
found.valid    // => true

const missing = await validmail('a@unknown.test', { resolver })
missing.reason // => 'domain_not_found'
```

Throw errors with Node's DNS error codes in `error.code`:

- `ENOTFOUND`: the domain does not exist.
- `ENODATA`: the domain exists but has no records of that type.
- Any other code: a DNS failure (`status: 'error'`, `reason: 'dns_error'`). `ETIMEOUT` gives `reason: 'timeout'`.

`resolve4` and `resolve6` are optional. They are used for the implicit MX fallback.

### Cache DNS results

The built-in cache is on by default:

- It keeps each domain's result for 1 hour (`cacheTtl`, in milliseconds).
- It holds at most 10,000 domains. The oldest entries are removed first.
- It stores only definite answers (pass or fail), never timeouts or DNS errors.
- When many checks for the same domain run at the same time, they share one DNS query.

```js
import validmail, { clearCache } from 'validmail'

const cache = new Map() // your own cache, which you can inspect or share
await validmail('ann@gmail.com', { cache, cacheTtl: 10 * 60_000 }) // keep for 10 minutes
const second = await validmail('bob@gmail.com', { cache })

second.checks.mx.cached // => true
cache.size              // => 1  (one domain)

await validmail('ann@gmail.com', { cache: false }) // always asks DNS
clearCache() // empties the built-in cache; a Map you passed in is yours to clear
```

### Set a timeout or cancel a check

`timeout` (default `5000` ms) limits the whole DNS check, including the A/AAAA fallback. A slow answer becomes a result, not an exception:

```js
const result = await validmail(email, { timeout: 2000 })

result.checks.mx.status // => 'error'    (when DNS was too slow)
result.reason           // => 'timeout'  ('dns_error' when DNS failed)
```

`status: 'error'` means "the check could not finish", not "this address is bad". Use `allowDnsErrors: true` to accept these addresses. `checks.mx.status` stays `'error'`, so you can log them or check again later.

To cancel a check, pass an `AbortSignal`. Unlike `timeout`, an abort **rejects** the promise with `signal.reason`:

```js
try {
  await validmail(email, { signal: AbortSignal.timeout(1000) })
} catch (err) {
  err.name // => 'TimeoutError'
}
```

### Read the result

`validmail()`, `validateSync()` and `validateMany()` return the same result object. This is the result for `jane@example.com`:

```js
{
  valid: false,
  reason: 'null_mx',            // reason of the first check that failed (undefined when valid)
  message: 'The domain "example.com" does not accept email (null MX record, RFC 7505).',
  email: 'jane@example.com',    // normalized: trimmed, domain lowercased
  local: 'jane',                // the part before "@", case kept
  domain: 'example.com',        // Unicode form for Unicode domains ('bücher.de')
  asciiDomain: 'example.com',   // punycode form used for DNS ('xn--bcher-kva.de')
  quoted: false,                // the local part is quoted ("john doe"@...)
  ipLiteral: false,             // the domain is an IP address (user@[192.0.2.1])
  checks: {
    syntax:     { status: 'pass' },
    disposable: { status: 'pass', isDisposable: false },
    role:       { status: 'pass', isRole: false },
    mx:         { status: 'fail', reason: 'null_mx', message: '...' },
  },
  // mxRecords: [...]           // sorted MX records, only when the MX check passed
}
```

Each check has a `status`:

| `status` | Meaning |
|---|---|
| `'pass'` | The check passed. |
| `'fail'` | The check failed. The address is invalid. |
| `'error'` | MX only. DNS timed out or failed (for example SERVFAIL or no network). The address might be fine. It counts as invalid unless `allowDnsErrors: true`. |
| `'skip'` | The check did not run: it is turned off, the domain is an IP address, or an earlier check failed. |

Extra fields: `checks.disposable` has `match` (the list entry that matched) and `source` (`'builtin'`, `'blockDomains'` or `'allowDomains'`). `checks.role` has `role` (for example `'support'`). `checks.mx` has `records`, `implicit` (implicit MX was used), `cached` and `code` (the DNS error code).

In TypeScript, checking `valid` narrows the type: when `valid` is `false`, `reason` and `message` are always set.

#### Reason codes

| Check | `reason` | Meaning |
|---|---|---|
| syntax | `invalid_type` | The input is not a string. |
| | `empty` | The input is empty or only spaces. |
| | `too_long` | More than 254 characters (counted in bytes, with the domain in punycode). |
| | `missing_at` | There is no `@`. |
| | `local_empty` | Nothing before the `@`. |
| | `local_too_long` | The part before the `@` is longer than 64 bytes. |
| | `local_invalid_char` | The part before the `@` has a character that is not allowed (space, `@`, `(`, `<`, control characters, ...). The message names it. |
| | `local_unicode` | The part before the `@` has non-ASCII characters, and `allowUnicodeLocal` is off. |
| | `local_dot` | The part before the `@` starts or ends with a dot, or has two dots in a row. |
| | `quoted_not_allowed` | A quoted local part (`"john doe"@...`), and `allowQuoted` is off. |
| | `quoted_invalid` | A quoted local part that is malformed. |
| | `domain_empty` | Nothing after the `@`. |
| | `domain_too_long` | The domain is longer than 253 characters. |
| | `domain_label_too_long` | One part of the domain (between dots) is longer than 63 characters. |
| | `domain_invalid` | Not a valid host name: characters other than letters, digits and hyphens, a part that starts or ends with `-`, an empty part (`a..com`, trailing dot), or bad punycode. |
| | `domain_no_tld` | No dot in the domain (`user@localhost`), and `requireTld` is on. |
| | `tld_invalid` | The top-level domain is a number (`user@1.2.3.4`) or one letter. |
| | `ip_literal_not_allowed` | An IP address as domain (`user@[192.0.2.1]`), and `allowIpLiteral` is off. |
| | `ip_literal_invalid` | A malformed IP address in brackets. |
| disposable | `disposable` | The domain (or a parent domain) is on the built-in disposable list. |
| | `blocked` | The domain (or a parent domain) is in `blockDomains`. |
| role | `role` | A role account, and `rejectRole: true`. |
| mx | `domain_not_found` | The domain does not exist (NXDOMAIN). |
| | `no_mx` | The domain exists but has no MX records and no A/AAAA address. |
| | `null_mx` | The domain says it accepts no email (RFC 7505 null MX, `MX 0 .`). |
| | `timeout` | DNS did not answer within `timeout`. Status `'error'`. |
| | `dns_error` | DNS failed, for example SERVFAIL or no network. Status `'error'`; the DNS code is in `checks.mx.code`. |

## API

All functions are named exports. The default export `validmail` is a function that also carries every function as a property: `validmail.sync`, `validmail.validateMany`, `validmail.checkSyntax`, and so on. With CommonJS, `require('validmail')` returns that same function, so `const { validateSync } = require('validmail')` also works.

### validmail(email, options?)

```ts
function validmail(email: string, options?: ValidmailOptions): Promise<ValidationResult>
```

Runs every check, including DNS. It never rejects for a bad address; it rejects only when `options.signal` aborts. `validate(email, options?)` is the same function as a named export.

**Syntax options** (also used by `validateSync`, `validateMany`, `checkSyntax`, `isValidEmail`):

| Option | Type | Default | Description |
|---|---|---|---|
| `allowQuoted` | `boolean` | `false` | Accept quoted local parts: `"john doe"@example.com`. |
| `allowIpLiteral` | `boolean` | `false` | Accept `user@[192.0.2.1]` and `user@[IPv6:2001:db8::1]`. The disposable and DNS checks are skipped for these. |
| `allowUnicodeLocal` | `boolean` | `false` | Accept non-ASCII characters before the `@` (`josé@example.com`, RFC 6531). Many mail servers still reject them. Unicode **domains** are always accepted. |
| `requireTld` | `boolean` | `true` | Require a dot in the domain. Set `false` for intranet hosts like `user@localhost`. |

**Domain and role options** (also used by `validateSync`, `validateMany`, `isValidEmail`):

| Option | Type | Default | Description |
|---|---|---|---|
| `disposable` | `boolean` | `true` | Reject known disposable domains. `false` only flags them in `checks.disposable.isDisposable`. |
| `blockDomains` | `Iterable<string>` | none | Array or Set of extra domains to reject, subdomains included. A leading `@` or `.` is ignored. Applies even with `disposable: false`. |
| `allowDomains` | `Iterable<string>` | none | Domains exempt from the built-in disposable list, subdomains included. Does not override `blockDomains`. |
| `rejectRole` | `boolean` | `false` | Reject role accounts (`admin@`, `info@`, `support@`, `noreply@`, ...). By default they are only flagged in `checks.role`. |

**DNS options** (also used by `validateMany`, `checkMx`, `isValidEmailAsync`):

| Option | Type | Default | Description |
|---|---|---|---|
| `mx` | `boolean` | `true` | Check that the domain can receive email. `false` skips DNS. Not used by `checkMx`. |
| `timeout` | `number` | `5000` | Milliseconds before the DNS check gives up (`status: 'error'`, `reason: 'timeout'`). Covers the MX query and the A/AAAA fallback. `0` turns it off. |
| `allowDnsErrors` | `boolean` | `false` | Count DNS timeouts and failures as valid. `checks.mx.status` is still `'error'`. Not used by `checkMx`. |
| `implicitMx` | `boolean` | `true` | Accept domains without MX records that have an A or AAAA address (RFC 5321 §5.1). `false` requires real MX records. |
| `resolver` | `Resolver` | system DNS | Object with `resolveMx(host)` and optionally `resolve4(host)` / `resolve6(host)`, all returning promises. `dns.promises`, `new dns.promises.Resolver()` and test fakes fit. |
| `cache` | `boolean \| Map` | `true` | `true`: built-in in-memory cache (one per resolver, at most 10,000 domains). `false`: no cache. A `Map`: your own cache, which you can share or inspect. Only definite answers are cached. |
| `cacheTtl` | `number` | `3600000` | Milliseconds a cached result stays fresh (1 hour). |
| `signal` | `AbortSignal` | none | Cancels the check. The promise rejects with `signal.reason`. |

### validateSync(email, options?)

```ts
function validateSync(email: string, options?: SyncOptions): ValidationResult
```

The same checks without DNS: syntax, disposable, block list and role. Takes the syntax, domain and role options. `checks.mx.status` is always `'skip'`. Also available as `validmail.sync`.

### validateMany(emails, options?)

```ts
function validateMany(emails: Iterable<string>, options?: ValidateManyOptions): Promise<ValidationResult[]>
```

Validates an array (or any iterable) and returns results in input order. Takes all `validmail()` options, plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `concurrency` | `number` | `10` | Maximum number of addresses checked at the same time. Must be a positive integer, or the function throws a `RangeError`. |

### checkSyntax(email, options?)

```ts
function checkSyntax(email: string, options?: SyntaxOptions): SyntaxResult
```

Syntax only. Returns `{ valid, reason?, message?, email, local, domain, asciiDomain, quoted, ipLiteral }`. Takes the syntax options. Input longer than 254 characters is rejected before it is scanned.

### checkMx(domainOrEmail, options?)

```ts
function checkMx(domainOrEmail: string, options?: MxOptions): Promise<MxCheck>
```

DNS only. Accepts a domain or a full address. Returns `{ status, reason?, message?, records?, implicit?, cached?, code? }`. Takes the DNS options. Throws a `TypeError` if the domain is not a valid host name.

```js
await checkMx('gmail.com')   // => { status: 'pass', records: [{ exchange: 'gmail-smtp-in.l.google.com', priority: 5 }, ...] }
await checkMx('example.com') // => { status: 'fail', reason: 'null_mx', message: '...' }
```

### isValidEmail(email, options?)

```ts
function isValidEmail(email: string, options?: SyncOptions): boolean
```

Short for `validateSync(email, options).valid`. Synchronous, no DNS.

### isValidEmailAsync(email, options?)

```ts
function isValidEmailAsync(email: string, options?: ValidmailOptions): Promise<boolean>
```

Short for `(await validmail(email, options)).valid`.

### isDisposable(emailOrDomain)

```ts
function isDisposable(emailOrDomain: string): boolean
```

`true` if the domain, or a parent domain, is on the built-in disposable list. `isDisposable('x@sub.mailinator.com')` is `true`.

### isRoleAccount(emailOrLocal)

```ts
function isRoleAccount(emailOrLocal: string): boolean
```

`true` for role mailboxes, ignoring case and `+tags`. `isRoleAccount('Support+billing@example.com')` is `true`.

### disposableDomains

```ts
const disposableDomains: readonly string[]
```

The built-in disposable list: lowercase ASCII, sorted, frozen.

### clearCache()

```ts
function clearCache(): void
```

Empties the built-in DNS caches. A `Map` you passed as `cache` is not touched.

### Types

`ValidationResult`, `ValidmailOptions`, `SyncOptions`, `SyntaxOptions`, `MxOptions`, `ValidateManyOptions`, `Checks`, `SyntaxCheck`, `DisposableCheck`, `RoleCheck`, `MxCheck`, `MxRecord`, `MxCacheEntry`, `Resolver`, `Reason`, `SyntaxReason`, `MxReason`, `DisposableReason`, `CheckStatus`, `SyntaxResult`, `EmailParts`, `Outcome`, `Validmail`.

## Comparison

| | `deep-email-validator` | `email-validator` | `email-existence` | `mailchecker` | **validmail** |
|---|---|---|---|---|---|
| Syntax | One `@`, a dot in the domain, no whitespace | Regex + 254/64/63 length limits | `\S+@\S+` | Full RFC regex | RFC 5321/5322 with lengths, dot rules, options for quoted / IP literal / UTF-8 |
| Unicode (IDN) domains | Passed to DNS unconverted | No (rejected) | Passed to DNS unconverted | No (rejected) | Yes (converted to punycode) |
| Disposable domains | Yes (large list, exact match only) | No | No | Yes (~56,000, subdomain-aware) | Yes (~590 curated, subdomain-aware, block/allow lists) |
| MX lookup | Yes | No | Yes | No | Yes |
| A/AAAA fallback (RFC 5321 §5.1) | No | n/a | No | n/a | Yes |
| Null MX (RFC 7505) | No | n/a | No | n/a | Yes (`reason: 'null_mx'`) |
| DNS error vs. "no mail server" | No (any DNS error means "MX record not found") | n/a | No | n/a | Yes (`status: 'error'` vs `'fail'`, `allowDnsErrors`) |
| DNS timeout | No | n/a | No (SMTP timeout only) | n/a | Yes (`timeout`, `AbortSignal`) |
| Custom / fake DNS resolver | No | n/a | No | n/a | Yes |
| Cache + shared in-flight lookups | No | n/a | No | n/a | Yes |
| SMTP `RCPT TO` probing | Yes (**on by default**, port 25) | No | Yes (its main feature) | No | No ([by design](#why-no-smtp-check)) |
| Says which check failed | Yes | No (boolean) | No (boolean) | No (boolean) | Yes (reason code + message per check) |
| API | Promise | Sync | Callback | Sync | Promise + sync |
| Runtime dependencies | 2 | 0 | 1 | 0 | 0 |
| Unpacked size | 13 MB | 12 KB | 4 KB | 1 MB | 87 KB |
| TypeScript types | Yes | Yes | No | Yes | Yes |

Compared with `deep-email-validator@0.1.27`, `email-validator@2.0.4`, `email-existence@0.1.6` and `mailchecker@6.0.21`.

`deep-email-validator` also runs a typo check by default and marks an address invalid when `mailcheck` suggests a different domain. validmail does not guess: typo suggestions belong in the form (see [inboxok](https://www.npmjs.com/package/inboxok)). If you need the largest disposable list, use `mailchecker`'s list as `blockDomains` (see [Block or allow more domains](#block-or-allow-more-domains)).

## Notes and limitations

- **It cannot prove that a mailbox exists.** Only a confirmation email can (see [Why no SMTP check?](#why-no-smtp-check)).
- **No typo suggestions** (`gmial.com` to `gmail.com`). That belongs in the form, before submit: use [inboxok](https://www.npmjs.com/package/inboxok). Common typo domains are often registered and accept email (`gmial.com` passes the MX check), so DNS alone does not catch them.
- **Provider aliases are not merged.** Gmail dots and `+tags` are kept as typed in the part before the `@`.
- **The disposable list is not complete.** New services appear every day; the built-in list covers the common ones. Add more with `blockDomains`.
- **IP address domains** (`user@[192.0.2.1]`, with `allowIpLiteral`) skip the disposable and DNS checks.
- **Errors and timeouts are not cached**, so the next check asks DNS again.

### Why no SMTP check?

Some validators connect to the recipient's mail server and send `RCPT TO` to ask whether the mailbox exists. validmail does not do this, on purpose:

- **It is not reliable.** Catch-all domains accept every address. Other servers delay the first try (greylisting), limit the number of requests, or refuse to answer unknown senders, to stop address harvesting. You get "valid" for addresses that do not exist and "invalid" for real ones.
- **It gets you blocked.** Opening port 25 connections and closing them before sending looks like a spammer collecting addresses. Providers may block your server's IP, which can hurt the real email you send.
- **It often cannot run at all.** Most cloud and hosting providers block outgoing port 25 by default, so the check just times out.
- **It is slow.** It takes seconds per address, which is too long for a sign-up request.

The only reliable way to know that a mailbox exists is to send a confirmation email. validmail catches everything you can know without sending one: bad syntax, disposable services, and domains that cannot receive email.

## Requirements

- Node.js 20 or later. Bun and Deno also work: validmail uses only `node:dns`, `node:net` and `node:url`, which they provide.
- Server only: it needs DNS. In the browser, use [inboxok](https://www.npmjs.com/package/inboxok).
- ESM and CommonJS builds.
- TypeScript types included.
- Zero dependencies. Network calls are DNS lookups only.

## License

MIT
