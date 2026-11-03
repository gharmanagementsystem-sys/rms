import { Router } from 'express';
import { env } from '../../config/env';

/**
 * Public, unauthenticated pages required by app-store policy.
 *
 * Google Play needs a web URL where a user can learn how to delete their
 * account and what happens to their data, reachable without signing in.
 */
export const legalRouter: Router = Router();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderDeleteAccountPage(): string {
  const appName = escapeHtml(env.APP_NAME);
  const email = env.SUPPORT_EMAIL ? escapeHtml(env.SUPPORT_EMAIL) : null;
  const contact = email
    ? `<a href="mailto:${email}?subject=Delete%20my%20account">${email}</a>`
    : 'the support email shown on our Google Play listing';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delete your account — ${appName}</title>
<style>
  body { font-family: system-ui, sans-serif; line-height: 1.6; color: #1f2933; max-width: 640px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 1.5rem; } h2 { font-size: 1.15rem; margin-top: 2rem; }
  a { color: #1d5c4a; }
</style>
</head>
<body>
<h1>Delete your ${appName} account</h1>
<p>This page explains how to ask us to delete your <strong>${appName}</strong> account and the data linked to it.</p>

<h2>How to request deletion</h2>
<ol>
  <li>Send an email to ${contact} with the subject <strong>Delete my account</strong>.</li>
  <li>Write from the email address you use to sign in, so we can confirm the account is yours. If you sign in with a different address, tell us which one.</li>
  <li>We will confirm by email and delete your account within 30 days of confirming it is yours.</li>
</ol>

<h2>What is deleted</h2>
<ul>
  <li>Your sign-in account and profile (name, email, phone number, location, profile photo).</li>
  <li>Your preferences, notification history and registered devices.</li>
  <li>Properties, units and rental records that you created as an owner, including their rent periods and payment records.</li>
</ul>

<h2>What may be kept</h2>
<ul>
  <li>Rental and payment records that belong to another person's account, for example your landlord's or tenant's own books, remain in their account. Your personal details in those records are anonymised where the app allows.</li>
  <li>Security and server logs are kept for up to 90 days and then removed.</li>
  <li>Anything we are legally required to retain.</li>
</ul>

<p>Deletion is permanent and cannot be undone. Export or note down any rent records you need before you ask.</p>
</body>
</html>`;
}

legalRouter.get('/delete-account', (_req, res) => {
  res.type('html').send(renderDeleteAccountPage());
});
