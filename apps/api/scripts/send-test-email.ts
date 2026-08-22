import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from '../src/config/env';
import {
  passwordChangedTemplate,
  resetPasswordTemplate,
  verifyEmailTemplate,
} from '../src/services/email/templates';
import { mailer } from '../src/services/mailer';

/**
 * Renders every transactional email, and optionally sends them.
 *
 * Preview only (writes HTML files you can open in a browser):
 *   npm run email:preview -w @rms/api
 *
 * Actually send, to check rendering in a real client:
 *   npm run email:preview -w @rms/api -- --send you@example.com
 *
 * Two modes because they answer different questions. Preview checks the markup
 * quickly and for free. Sending is the only way to know how Gmail and Outlook
 * actually treat it — email clients rewrite HTML, and nothing but a real inbox
 * proves the result.
 */

const SAMPLE_URL = `${env.BETTER_AUTH_URL}/api/auth/verify-email?token=sample-token-for-preview`;

const CASES = [
  {
    name: 'verify-email',
    en: verifyEmailTemplate({ url: SAMPLE_URL, name: 'Ram Bahadur Thapa', locale: 'en' }),
    ne: verifyEmailTemplate({ url: SAMPLE_URL, name: 'राम बहादुर थापा', locale: 'ne' }),
  },
  {
    name: 'reset-password',
    en: resetPasswordTemplate({ url: SAMPLE_URL, name: 'Ram Bahadur Thapa', locale: 'en' }),
    ne: resetPasswordTemplate({ url: SAMPLE_URL, name: 'राम बहादुर थापा', locale: 'ne' }),
  },
  {
    name: 'password-changed',
    en: passwordChangedTemplate({ name: 'Ram Bahadur Thapa', locale: 'en' }),
    ne: passwordChangedTemplate({ name: 'राम बहादुर थापा', locale: 'ne' }),
  },
] as const;

async function main(): Promise<void> {
  const sendIndex = process.argv.indexOf('--send');
  const recipient = sendIndex === -1 ? null : process.argv[sendIndex + 1];

  if (sendIndex !== -1 && !recipient) {
    console.error('\n  --send needs an address: --send you@example.com\n');
    process.exit(1);
  }

  const outDir = process.cwd();
  console.log(
    `\nTransport: ${env.RESEND_API_KEY ? 'Resend' : env.isEmailEnabled ? 'SMTP' : 'dev log'}`,
  );
  console.log(`From:      ${env.EMAIL_FROM ?? env.SMTP_FROM ?? '(none configured)'}\n`);

  for (const testCase of CASES) {
    for (const locale of ['en', 'ne'] as const) {
      const mail = testCase[locale];
      const file = join(outDir, `email-preview-${testCase.name}-${locale}.html`);
      writeFileSync(file, mail.html, 'utf8');

      console.log(`  ${testCase.name} (${locale})`);
      console.log(`    subject: ${mail.subject}`);
      console.log(`    html:    ${mail.html.length} bytes → ${file}`);
      console.log(`    text:    ${mail.text.split('\n').length} lines`);

      if (recipient && locale === 'en') {
        await mailer.send({
          to: recipient,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        console.log(`    SENT to ${recipient}`);
      }
    }
  }

  console.log(
    recipient
      ? `\n  English versions sent to ${recipient}. Check the inbox and the spam folder.\n`
      : '\n  Previews written. Open the .html files in a browser, then re-run with --send to test a real client.\n',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
