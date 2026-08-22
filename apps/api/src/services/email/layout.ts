/**
 * The shared HTML shell for every outbound email.
 *
 * Email is not the web. The constraints this file works within, and why the
 * markup looks two decades old on purpose:
 *
 *  • **Tables for layout.** Outlook renders through Word's HTML engine, which
 *    has no flexbox and no grid. A `<div>`-based layout collapses there.
 *  • **Inline styles only.** Gmail strips `<style>` blocks in several contexts,
 *    including when it clips a long message. A class-based stylesheet is a
 *    layout that works until it doesn't.
 *  • **No external images.** Most clients block remote images by default, so
 *    anything load-bearing must be text or a coloured table cell. The wordmark
 *    here is text for exactly that reason.
 *  • **Every email ships a plain-text alternative.** Some clients prefer it,
 *    some users force it, and spam filters distrust HTML-only mail.
 *
 * The palette matches the app's light theme (global.css) so an email and the
 * screen it leads to feel like the same product.
 */

const PALETTE = {
  background: '#f4f1ec',
  surface: '#ffffff',
  ink: '#1a1f1d',
  inkSoft: '#5c625f',
  border: '#e3ded7',
  primary: '#14524a',
  accent: '#b8863b',
  danger: '#a93226',
} as const;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Blocks an attacker-supplied name or address from injecting markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailButton {
  label: string;
  url: string;
}

export interface EmailLayoutOptions {
  /** Shown in the coloured header bar. */
  appName: string;
  /** Large heading inside the card. */
  heading: string;
  /** Body paragraphs, already escaped or known-safe. */
  paragraphs: string[];
  button?: EmailButton | undefined;
  /**
   * Small print under the button — link expiry, "ignore this if it wasn't
   * you", and so on.
   */
  footnotes?: string[] | undefined;
  /** Renders the accent bar in the danger colour, for security alerts. */
  tone?: 'normal' | 'alert';
  /** Appended below the divider, e.g. a support address. */
  signoff: string;
}

/**
 * A tappable button.
 *
 * Wrapped in its own table because Outlook ignores padding on an anchor, which
 * would otherwise render the call to action as bare underlined text.
 */
function renderButton(button: EmailButton, tone: 'normal' | 'alert'): string {
  const background = tone === 'alert' ? PALETTE.danger : PALETTE.primary;

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 8px;">
      <tr>
        <td align="center" bgcolor="${background}" style="border-radius: 10px;">
          <a href="${escapeHtml(button.url)}"
             style="display: inline-block; padding: 14px 28px; font-family: ${FONT_STACK}; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px;">
            ${escapeHtml(button.label)}
          </a>
        </td>
      </tr>
    </table>`;
}

export function renderEmailHtml(options: EmailLayoutOptions): string {
  const { appName, heading, paragraphs, button, footnotes, signoff, tone = 'normal' } = options;
  const accent = tone === 'alert' ? PALETTE.danger : PALETTE.accent;

  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin: 0 0 16px; font-family: ${FONT_STACK}; font-size: 16px; line-height: 26px; color: ${PALETTE.ink};">${paragraph}</p>`,
    )
    .join('\n');

  const smallPrint = (footnotes ?? [])
    .map(
      (note) =>
        `<p style="margin: 0 0 8px; font-family: ${FONT_STACK}; font-size: 13px; line-height: 20px; color: ${PALETTE.inkSoft};">${note}</p>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PALETTE.background};">
  <!-- Preheader: the grey line clients show beside the subject. Kept out of
       sight so it does not repeat the heading inside the message. -->
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(heading)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${PALETTE.background};">
    <tr>
      <td align="center" style="padding: 32px 16px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; width: 100%;">

          <!-- Wordmark. Text, not an image, so it survives blocked remote content. -->
          <tr>
            <td style="padding: 0 4px 16px;">
              <span style="font-family: ${FONT_STACK}; font-size: 15px; font-weight: 700; letter-spacing: 0.02em; color: ${PALETTE.primary};">
                ${escapeHtml(appName)}
              </span>
            </td>
          </tr>

          <tr>
            <td style="background-color: ${PALETTE.surface}; border: 1px solid ${PALETTE.border}; border-radius: 14px; overflow: hidden;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <!-- A 4px accent rule instead of a banner image. -->
                <tr><td bgcolor="${accent}" height="4" style="height: 4px; line-height: 4px; font-size: 0;">&nbsp;</td></tr>

                <tr>
                  <td style="padding: 32px 28px 28px;">
                    <h1 style="margin: 0 0 18px; font-family: ${FONT_STACK}; font-size: 24px; line-height: 32px; font-weight: 700; color: ${PALETTE.ink};">
                      ${escapeHtml(heading)}
                    </h1>

                    ${body}
                    ${button ? renderButton(button, tone) : ''}
                    ${smallPrint}

                    ${
                      button
                        ? `<p style="margin: 20px 0 0; padding-top: 18px; border-top: 1px solid ${PALETTE.border}; font-family: ${FONT_STACK}; font-size: 12px; line-height: 19px; color: ${PALETTE.inkSoft};">
                             If the button does not work, copy this link into your browser:<br>
                             <span style="color: ${PALETTE.primary}; word-break: break-all;">${escapeHtml(button.url)}</span>
                           </p>`
                        : ''
                    }
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td style="padding: 20px 8px 0;">
              <p style="margin: 0; font-family: ${FONT_STACK}; font-size: 12px; line-height: 19px; color: ${PALETTE.inkSoft};">
                ${signoff}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The plain-text alternative.
 *
 * Built from the same content rather than written twice, so the two versions
 * cannot drift and say different things.
 */
export function renderEmailText(options: EmailLayoutOptions): string {
  const { heading, paragraphs, button, footnotes, signoff } = options;

  const stripTags = (value: string): string =>
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .trim();

  const lines = [heading, '', ...paragraphs.map(stripTags)];

  if (button) {
    lines.push('', `${button.label}:`, button.url);
  }
  if (footnotes && footnotes.length > 0) {
    lines.push('', ...footnotes.map(stripTags));
  }
  lines.push('', stripTags(signoff));

  return lines.join('\n');
}
