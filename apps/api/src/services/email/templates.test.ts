import { describe, expect, it } from 'vitest';
import { escapeHtml, renderEmailHtml, renderEmailText } from './layout';
import { passwordChangedTemplate, resetPasswordTemplate, verifyEmailTemplate } from './templates';

const LINK = 'https://api.example.com/api/auth/verify-email?token=abc123';

describe('escapeHtml', () => {
  it('neutralises markup in a user-supplied name', () => {
    // A display name is user input. Without escaping, a name is a script tag.
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes quotes, which would otherwise break out of an attribute', () => {
    expect(escapeHtml('a" onmouseover="evil')).toBe('a&quot; onmouseover=&quot;evil');
  });

  it('escapes ampersands first so escaping is not double-applied', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });
});

describe('email layout', () => {
  const options = {
    appName: 'Gharbeti',
    heading: 'Confirm your email',
    paragraphs: ['First line.', 'Second line.'],
    button: { label: 'Confirm', url: LINK },
    footnotes: ['Expires in one hour.'],
    signoff: 'Automated message.',
  };

  it('uses tables rather than flexbox, because Outlook has no flexbox', () => {
    const html = renderEmailHtml(options);
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/display:\s*flex/i);
    expect(html).not.toMatch(/display:\s*grid/i);
  });

  it('inlines its styles rather than relying on a stylesheet', () => {
    // Gmail strips <style> blocks in several contexts, including clipped mail.
    const html = renderEmailHtml(options);
    expect(html).not.toContain('<style');
    expect(html).toContain('style="');
  });

  it('embeds no remote images, which most clients block by default', () => {
    expect(renderEmailHtml(options)).not.toContain('<img');
  });

  it('shows the raw link as a fallback when the button cannot be tapped', () => {
    expect(renderEmailHtml(options)).toContain(LINK);
  });

  it('produces a plain-text alternative carrying the same link', () => {
    const text = renderEmailText(options);
    expect(text).toContain('Confirm your email');
    expect(text).toContain(LINK);
    expect(text).toContain('Expires in one hour.');
  });

  it('strips tags from the text version rather than leaking markup', () => {
    const text = renderEmailText({
      ...options,
      paragraphs: ['This is <strong>important</strong>.'],
    });
    expect(text).toContain('This is important.');
    expect(text).not.toContain('<strong>');
  });
});

describe('verifyEmailTemplate', () => {
  it('carries the verification link in both parts', () => {
    const mail = verifyEmailTemplate({ url: LINK, name: 'Ram' });
    expect(mail.html).toContain(LINK);
    expect(mail.text).toContain(LINK);
    expect(mail.subject.length).toBeGreaterThan(0);
  });

  it('greets the user by name when one is known', () => {
    expect(verifyEmailTemplate({ url: LINK, name: 'Ram Thapa' }).html).toContain('Ram Thapa');
  });

  it('reads correctly when there is no name', () => {
    const mail = verifyEmailTemplate({ url: LINK, name: null });
    // Must not produce "Welcome, ." or an empty greeting.
    expect(mail.html).not.toMatch(/Welcome,\s*\./);
    expect(mail.text).toContain('Welcome');
  });

  it('escapes a hostile display name', () => {
    const mail = verifyEmailTemplate({ url: LINK, name: '<img src=x onerror=alert(1)>' });
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain('&lt;img');
  });

  it('writes in Nepali when that is the stored preference', () => {
    const mail = verifyEmailTemplate({ url: LINK, name: 'राम', locale: 'ne' });
    expect(mail.subject).toContain('इमेल');
    expect(mail.html).toContain('स्वागत');
    // Still the same link — only the prose changes.
    expect(mail.html).toContain(LINK);
  });

  it('says the link is single-use and expires', () => {
    const mail = verifyEmailTemplate({ url: LINK });
    expect(mail.text.toLowerCase()).toContain('once');
    expect(mail.text.toLowerCase()).toContain('hour');
  });
});

describe('resetPasswordTemplate', () => {
  it('states that nothing has changed yet', () => {
    // A reset email that reads as though the password is already gone causes
    // panic, and panic is what makes people click phishing links.
    const mail = resetPasswordTemplate({ url: LINK, name: 'Ram' });
    expect(mail.text).toContain('has not changed yet');
  });

  it('tells the user what to do if it was not them', () => {
    expect(resetPasswordTemplate({ url: LINK }).text).toContain('not you');
  });

  it('has a Nepali version of the same reassurance', () => {
    const mail = resetPasswordTemplate({ url: LINK, locale: 'ne' });
    expect(mail.html).toContain('अझै फेरिएको छैन');
  });
});

describe('passwordChangedTemplate', () => {
  it('is an alert, and carries no action link by default', () => {
    // Deliberately linkless: a security alert that contains a clickable link is
    // indistinguishable from the phishing it warns about.
    const mail = passwordChangedTemplate({ name: 'Ram' });
    expect(mail.html).not.toContain('http');
    expect(mail.subject).toContain('changed');
  });

  it('says other sessions were signed out', () => {
    expect(passwordChangedTemplate({}).text).toContain('signed out');
  });

  it('tells the user to act if it was not them', () => {
    expect(passwordChangedTemplate({}).text.toLowerCase()).toContain('if this was not you');
  });

  it('has a Nepali version', () => {
    const mail = passwordChangedTemplate({ locale: 'ne' });
    expect(mail.subject).toContain('पासवर्ड');
    expect(mail.html).toContain('साइन आउट');
  });
});

describe('every template', () => {
  const all = [
    verifyEmailTemplate({ url: LINK, name: 'Ram' }),
    verifyEmailTemplate({ url: LINK, name: 'राम', locale: 'ne' }),
    resetPasswordTemplate({ url: LINK, name: 'Ram' }),
    resetPasswordTemplate({ url: LINK, name: 'राम', locale: 'ne' }),
    passwordChangedTemplate({ name: 'Ram' }),
    passwordChangedTemplate({ name: 'राम', locale: 'ne' }),
  ];

  it('has a non-empty subject, html and text', () => {
    for (const mail of all) {
      expect(mail.subject.trim().length).toBeGreaterThan(0);
      expect(mail.html.length).toBeGreaterThan(500);
      expect(mail.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('is a complete HTML document', () => {
    for (const mail of all) {
      expect(mail.html.startsWith('<!doctype html>')).toBe(true);
      expect(mail.html).toContain('</html>');
    }
  });

  it('never leaves an unreplaced placeholder', () => {
    for (const mail of all) {
      expect(mail.html).not.toMatch(/\{\{|\}\}|undefined|\[object/);
      expect(mail.text).not.toMatch(/\{\{|\}\}|undefined|\[object/);
    }
  });

  it('keeps the subject short enough not to be truncated in an inbox list', () => {
    for (const mail of all) {
      expect(mail.subject.length).toBeLessThanOrEqual(78);
    }
  });
});
