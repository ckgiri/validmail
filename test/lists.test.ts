import { describe, expect, it } from 'vitest';
import { checkSyntax, disposableDomains, isDisposable, isRoleAccount, validateSync, isValidEmail } from '../src/index';

describe('built-in disposable list', () => {
  it('has several hundred unique, sorted, valid lowercase domains', () => {
    expect(disposableDomains.length).toBeGreaterThan(400);
    expect(new Set(disposableDomains).size).toBe(disposableDomains.length);
    expect([...disposableDomains].sort()).toEqual(disposableDomains);
    for (const d of disposableDomains) {
      const r = checkSyntax(`x@${d}`);
      expect(r.valid, d).toBe(true);
      expect(r.asciiDomain, d).toBe(d);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(disposableDomains)).toBe(true);
  });

  it('contains no mainstream mail providers', () => {
    const legit = [
      'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com',
      'me.com', 'aol.com', 'protonmail.com', 'proton.me', 'pm.me', 'gmx.de', 'gmx.net', 'web.de', 'mail.ru', 'yandex.ru',
      'qq.com', '163.com', 'zoho.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'duck.com', 'mail.com', 'email.com',
      'comcast.net', 'verizon.net', 'att.net', 'orange.fr', 'free.fr', 'libero.it', 't-online.de', 'naver.com',
    ];
    for (const d of legit) expect(isDisposable(d), d).toBe(false);
  });
});

describe('isDisposable', () => {
  it('matches domains and addresses, case-insensitively', () => {
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('someone@Mailinator.COM')).toBe(true);
    expect(isDisposable('yopmail.fr')).toBe(true);
    expect(isDisposable('gmail.com')).toBe(false);
    expect(isDisposable('user@gmail.com')).toBe(false);
  });

  it('is subdomain-aware on label boundaries', () => {
    expect(isDisposable('x.y.mailinator.com')).toBe(true);
    expect(isDisposable('mymailinator.com')).toBe(false);
    expect(isDisposable('mailinator.com.example.org')).toBe(false);
  });

  it('normalizes IDN and look-alike forms', () => {
    expect(isDisposable('a@ｍａｉｌｉｎａｔｏｒ.com')).toBe(true);
    expect(isDisposable('mailinator.com.')).toBe(true);
  });

  it('handles junk input', () => {
    expect(isDisposable('')).toBe(false);
    expect(isDisposable(undefined as unknown as string)).toBe(false);
  });
});

describe('disposable check in validateSync', () => {
  it('rejects disposable domains with details', () => {
    const r = validateSync('someone@sub.mailinator.com');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('disposable');
    expect(r.checks.disposable).toMatchObject({ status: 'fail', isDisposable: true, match: 'mailinator.com', source: 'builtin' });
    expect(r.checks.mx.status).toBe('skip');
  });

  it('catches full-width spellings of disposable domains', () => {
    expect(validateSync('a@ｍａｉｌｉｎａｔｏｒ.com').reason).toBe('disposable');
  });

  it('disposable: false only flags', () => {
    const r = validateSync('someone@mailinator.com', { disposable: false });
    expect(r.valid).toBe(true);
    expect(r.checks.disposable).toMatchObject({ status: 'pass', isDisposable: true, match: 'mailinator.com' });
  });

  it('allowDomains exempts built-in entries (and subdomains)', () => {
    const r = validateSync('qa@team.mailinator.com', { allowDomains: ['mailinator.com'] });
    expect(r.valid).toBe(true);
    expect(r.checks.disposable).toMatchObject({ status: 'pass', isDisposable: true, source: 'allowDomains', match: 'mailinator.com' });
  });

  it('blockDomains rejects extra domains, subdomains included, and wins over allowDomains', () => {
    const opts = { blockDomains: ['@Competitor.com', '.spam.example'], allowDomains: ['competitor.com'] };
    expect(validateSync('a@competitor.com', opts)).toMatchObject({ valid: false, reason: 'blocked' });
    expect(validateSync('a@eu.competitor.com', opts).checks.disposable).toMatchObject({ status: 'fail', match: 'competitor.com', source: 'blockDomains' });
    expect(validateSync('a@x.spam.example', opts).reason).toBe('blocked');
    expect(validateSync('a@example.com', opts).valid).toBe(true);
    expect(validateSync('a@competitor.com', { ...opts, disposable: false }).reason).toBe('blocked');
  });

  it('accepts Sets and IDN entries', () => {
    expect(validateSync('a@bücher.de', { blockDomains: new Set(['BÜCHER.de']) }).reason).toBe('blocked');
    expect(validateSync('a@xn--bcher-kva.de', { blockDomains: new Set(['bücher.de']) }).reason).toBe('blocked');
  });

  it('re-reads mutable lists on every call', () => {
    const block: string[] = [];
    expect(validateSync('a@late.example', { blockDomains: block }).valid).toBe(true);
    block.push('late.example');
    expect(validateSync('a@late.example', { blockDomains: block }).valid).toBe(false);
  });

  it('throws on a string instead of a list', () => {
    expect(() => validateSync('a@b.com', { blockDomains: 'b.com' as unknown as string[] })).toThrow(TypeError);
  });
});

describe('role accounts', () => {
  it('isRoleAccount', () => {
    expect(isRoleAccount('admin@example.com')).toBe(true);
    expect(isRoleAccount('Support+tickets@example.com')).toBe(true);
    expect(isRoleAccount('no-reply@example.com')).toBe(true);
    expect(isRoleAccount('postmaster')).toBe(true);
    expect(isRoleAccount('john@example.com')).toBe(false);
    expect(isRoleAccount('administrators.john@example.com')).toBe(false);
    expect(isRoleAccount(42 as unknown as string)).toBe(false);
  });

  it('flags by default and rejects with rejectRole', () => {
    const flagged = validateSync('Info@example.com');
    expect(flagged.valid).toBe(true);
    expect(flagged.checks.role).toEqual({ status: 'pass', isRole: true, role: 'info' });

    const rejected = validateSync('info@example.com', { rejectRole: true });
    expect(rejected).toMatchObject({ valid: false, reason: 'role' });
    expect(rejected.checks.role.status).toBe('fail');
    expect(validateSync('jane@example.com', { rejectRole: true }).valid).toBe(true);
  });
});

describe('isValidEmail (sync)', () => {
  it('returns a boolean for syntax + disposable', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user@mailinator.com')).toBe(false);
    expect(isValidEmail('not an email')).toBe(false);
    expect(isValidEmail('admin@example.com', { rejectRole: true })).toBe(false);
  });
});
