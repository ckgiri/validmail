// Real DNS lookups. Skipped unless VALIDMAIL_NET=1 so the normal test run never touches the network.
import { describe, expect, it } from 'vitest';
import validmail, { checkMx } from '../src/index';

describe.skipIf(process.env.VALIDMAIL_NET !== '1')('real DNS (VALIDMAIL_NET=1)', () => {
  it('gmail.com has MX records', async () => {
    const r = await validmail('someone@gmail.com', { cache: false });
    expect(r.valid).toBe(true);
    expect(r.mxRecords!.length).toBeGreaterThan(0);
    expect(r.mxRecords![0]!.exchange).toMatch(/google\.com$/);
  });

  it('example.com publishes a null MX (RFC 7505)', async () => {
    expect(await checkMx('example.com', { cache: false })).toMatchObject({ status: 'fail', reason: 'null_mx' });
  });

  it('a random unregistered domain does not exist', async () => {
    const domain = `validmail-${Date.now().toString(36)}-nonexistent.com`;
    const r = await validmail(`a@${domain}`, { cache: false });
    expect(r.reason).toBe('domain_not_found');
  });
});
