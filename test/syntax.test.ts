import { describe, expect, it } from 'vitest';
import { checkSyntax, type SyntaxReason } from '../src/index';

describe('checkSyntax: valid addresses', () => {
  it.each([
    'user@example.com',
    'first.last@example.com',
    'user+tag@sub.example.co.uk',
    "o'brien@example.ie",
    "a!#$%&'*+/=?^_`{|}~-@example.com",
    'x@example.museum',
    '1234@example.com',
    'u@a.io',
    'user@ex-ample.com',
    'user@xn--bcher-kva.de',
    'user@123.example.com',
    'user@example.xn--zckzah',
  ])('%s', (email) => {
    const r = checkSyntax(email);
    expect(r.valid, r.message).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it('normalizes: trims, lowercases the domain, keeps the local part', () => {
    const r = checkSyntax('  John.Doe@EXAMPLE.Com \n');
    expect(r).toMatchObject({ valid: true, email: 'John.Doe@example.com', local: 'John.Doe', domain: 'example.com', asciiDomain: 'example.com' });
  });

  it('converts IDN domains to punycode for DNS', () => {
    const r = checkSyntax('user@Bücher.DE');
    expect(r).toMatchObject({ valid: true, email: 'user@bücher.de', domain: 'bücher.de', asciiDomain: 'xn--bcher-kva.de' });
    expect(checkSyntax('user@xn--bcher-kva.de')).toMatchObject({ domain: 'bücher.de', asciiDomain: 'xn--bcher-kva.de' });
    expect(checkSyntax('user@例え.テスト')).toMatchObject({ valid: true, asciiDomain: 'xn--r8jz45g.xn--zckzah' });
    // Full-width characters and ideographic dots map to ASCII (UTS #46)
    expect(checkSyntax('user@ｅｘａｍｐｌｅ。com')).toMatchObject({ valid: true, asciiDomain: 'example.com' });
  });

  it('accepts the maximum lengths', () => {
    const local = 'a'.repeat(64);
    expect(checkSyntax(`${local}@example.com`).valid).toBe(true);
    expect(checkSyntax(`user@${'a'.repeat(63)}.com`).valid).toBe(true);
    // 254 characters total: 64 + 1 + 189
    const domain = `${'a'.repeat(61)}.${'b'.repeat(61)}.${'c'.repeat(61)}.com`;
    const email = `${local}@${domain}`;
    expect(email.length).toBe(254);
    expect(checkSyntax(email).valid).toBe(true);
  });
});

describe('checkSyntax: invalid addresses', () => {
  const cases: [string, SyntaxReason][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['plainaddress', 'missing_at'],
    ['@example.com', 'local_empty'],
    ['user@', 'domain_empty'],
    ['.user@example.com', 'local_dot'],
    ['user.@example.com', 'local_dot'],
    ['us..er@example.com', 'local_dot'],
    ['us er@example.com', 'local_invalid_char'],
    ['a@b@example.com', 'local_invalid_char'],
    ['user(comment)@example.com', 'local_invalid_char'],
    ['John <john@example.com>', 'local_invalid_char'],
    ['us\ner@example.com', 'local_invalid_char'],
    ['josé@example.com', 'local_unicode'],
    ['"john doe"@example.com', 'quoted_not_allowed'],
    [`${'a'.repeat(65)}@example.com`, 'local_too_long'],
    [`${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.com`, 'too_long'],
    [`user@${'a'.repeat(64)}.com`, 'domain_label_too_long'],
    ['user@-example.com', 'domain_invalid'],
    ['user@example-.com', 'domain_invalid'],
    ['user@exa_mple.com', 'domain_invalid'],
    ['user@example..com', 'domain_invalid'],
    ['user@.example.com', 'domain_invalid'],
    ['user@example.com.', 'domain_invalid'],
    ['user@exa mple.com', 'domain_invalid'],
    ['user@exa%41mple.com', 'domain_invalid'],
    ['user@ex%41mplé.com', 'domain_invalid'],
    ['user@xn--a.com', 'domain_invalid'],
    ['user@example.com>', 'domain_invalid'],
    ['user@localhost', 'domain_no_tld'],
    ['user@example.123', 'tld_invalid'],
    ['user@1.2.3.4', 'tld_invalid'],
    ['user@0x7f.1', 'tld_invalid'],
    ['user@example.c', 'tld_invalid'],
    ['user@[192.0.2.1]', 'ip_literal_not_allowed'],
  ];
  it.each(cases)('%j → %s', (email, reason) => {
    const r = checkSyntax(email);
    expect(r.valid).toBe(false);
    expect(r.reason).toBe(reason);
    expect(typeof r.message).toBe('string');
  });

  it('rejects non-strings without throwing', () => {
    for (const v of [undefined, null, 42, {}, ['a@b.com']]) {
      expect(checkSyntax(v as unknown as string)).toMatchObject({ valid: false, reason: 'invalid_type' });
    }
  });

  it('names the offending character in the message', () => {
    expect(checkSyntax('us er@example.com').message).toContain('a space');
    expect(checkSyntax('a@b@example.com').message).toContain('"@"');
    expect(checkSyntax('us\ter@example.com').message).toContain('U+0009');
  });

  it('measures the local part in UTF-8 octets', () => {
    const r = checkSyntax(`${'é'.repeat(33)}@example.com`, { allowUnicodeLocal: true });
    expect(r.reason).toBe('local_too_long'); // 33 chars, 66 octets
    expect(checkSyntax(`${'é'.repeat(32)}@example.com`, { allowUnicodeLocal: true }).valid).toBe(true);
  });
});

describe('checkSyntax: options', () => {
  it('allowQuoted', () => {
    const opts = { allowQuoted: true };
    expect(checkSyntax('"john doe"@example.com', opts)).toMatchObject({ valid: true, quoted: true, local: '"john doe"' });
    expect(checkSyntax('"a@b"@example.com', opts).valid).toBe(true);
    expect(checkSyntax('"a\\"b"@example.com', opts).valid).toBe(true);
    expect(checkSyntax('"a\\\\"@example.com', opts).valid).toBe(true);
    expect(checkSyntax('""@example.com', opts).reason).toBe('quoted_invalid');
    expect(checkSyntax('"unterminated@example.com', opts).reason).toBe('quoted_invalid');
    expect(checkSyntax('"a"b"@example.com', opts).reason).toBe('quoted_invalid');
    expect(checkSyntax('"a\\"@example.com', opts).reason).toBe('quoted_invalid');
    expect(checkSyntax('"a\nb"@example.com', opts).reason).toBe('quoted_invalid');
    expect(checkSyntax('"é"@example.com', opts).reason).toBe('quoted_invalid');
    expect(checkSyntax('"é"@example.com', { ...opts, allowUnicodeLocal: true }).valid).toBe(true);
  });

  it('allowUnicodeLocal', () => {
    const opts = { allowUnicodeLocal: true };
    expect(checkSyntax('josé@example.com', opts).valid).toBe(true);
    expect(checkSyntax('用户@例子.广告', opts).valid).toBe(true);
    expect(checkSyntax('😀@example.com', opts).valid).toBe(true);
    expect(checkSyntax('a\u0085b@example.com', opts).reason).toBe('local_invalid_char'); // C1 control
    expect(checkSyntax('a\ud800b@example.com', opts).reason).toBe('local_invalid_char'); // lone surrogate
  });

  it('allowIpLiteral', () => {
    const opts = { allowIpLiteral: true };
    expect(checkSyntax('user@[192.0.2.1]', opts)).toMatchObject({ valid: true, ipLiteral: true, domain: '[192.0.2.1]' });
    expect(checkSyntax('user@[IPv6:2001:DB8::1]', opts)).toMatchObject({ valid: true, domain: '[IPv6:2001:db8::1]' });
    expect(checkSyntax('user@[ipv6:::1]', opts).valid).toBe(true);
    for (const bad of ['user@[999.1.1.1]', 'user@[IPv6:fe80::1%eth0]', 'user@[192.0.2.1', 'user@[example.com]', 'user@[2001:db8::1]', 'user@[]']) {
      expect(checkSyntax(bad, opts).reason, bad).toBe('ip_literal_invalid');
    }
  });

  it('requireTld: false', () => {
    expect(checkSyntax('user@localhost', { requireTld: false })).toMatchObject({ valid: true, domain: 'localhost' });
    expect(checkSyntax('user@123', { requireTld: false }).reason).toBe('tld_invalid');
  });
});

describe('checkSyntax: no ReDoS, linear time', () => {
  const adversarial = [
    'a'.repeat(1_000_000) + '@example.com',
    '@'.repeat(1_000_000),
    ' '.repeat(1_000_000) + 'a b@c.com' + ' '.repeat(1_000_000),
    'a.'.repeat(500_000) + '@x.com',
    '"' + '\\'.repeat(1_000_000),
    'a@' + 'a.'.repeat(500_000) + 'com',
    'a@[' + '1.'.repeat(500_000) + ']',
    'a@' + '-'.repeat(1_000_000),
    'a@' + 'é'.repeat(1_000_000),
  ];

  it('rejects huge inputs fast', () => {
    const start = performance.now();
    for (const input of adversarial) {
      expect(checkSyntax(input, { allowQuoted: true, allowIpLiteral: true, allowUnicodeLocal: true }).valid).toBe(false);
    }
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('handles many near-limit pathological inputs fast', () => {
    const inputs: string[] = [];
    for (let n = 1; n < 250; n++) {
      inputs.push('a'.repeat(n) + '@' + 'b'.repeat(250 - n));
      inputs.push('a.'.repeat(n >> 1) + '@' + 'b-'.repeat((250 - n) >> 1));
      inputs.push('"' + '\\"'.repeat(n >> 1) + '@x.co');
      inputs.push('x@' + 'a.'.repeat((250 - 2) >> 1) + '!');
    }
    const start = performance.now();
    for (let k = 0; k < 20; k++) for (const input of inputs) checkSyntax(input, { allowQuoted: true });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
