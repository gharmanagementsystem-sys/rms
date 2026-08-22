import { describe, expect, it } from 'vitest';
import { MemoryMailer } from './mailer';

describe('MemoryMailer', () => {
  it('captures messages for assertion', async () => {
    const mailer = new MemoryMailer();

    await mailer.send({ to: 'sita@example.com', subject: 'Confirm', text: 'link' });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: 'sita@example.com', subject: 'Confirm' });
  });
});

describe('mail content policy', () => {
  it('never puts a verification link in a production log', async () => {
    // Guards the rule that DevLogMailer — the only transport that writes a
    // message body to the log — refuses to exist in production. If someone
    // relaxes that, verification links (bearer credentials) would be logged on
    // a live server.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./mailer.ts', import.meta.url), 'utf8'),
    );

    expect(source).toContain('DevLogMailer must never be used in production');
    // The body is only ever logged from within DevLogMailer.
    const bodyLogOccurrences = source.match(/body: mail\.text/g) ?? [];
    expect(bodyLogOccurrences).toHaveLength(1);
  });
});
