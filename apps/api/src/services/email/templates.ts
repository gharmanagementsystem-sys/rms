import type { Language } from '@rms/shared';
import { env } from '../../config/env';
import { escapeHtml, renderEmailHtml, renderEmailText } from './layout';

/**
 * Every transactional email the product sends. CLAUDE.md §27, §40.
 *
 * PURE: no network, no database, no clock. Each function takes what it needs
 * and returns a finished message, which is what makes them testable and what
 * keeps copy decisions out of the auth configuration.
 *
 * Both languages live here rather than in the mobile i18n files, because these
 * strings are rendered on the server and the app never sees them. §27 still
 * applies — a Nepali user should not receive an English-only security alert
 * about their own account.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type Copy = Record<Language, string>;

function pick(copy: Copy, locale: Language): string {
  return copy[locale];
}

/** Signature line, shared by every message so the footer stays consistent. */
function signoff(locale: Language): string {
  const app = escapeHtml(env.APP_NAME);
  return pick(
    {
      en: `${app} · This is an automated message, so please do not reply to it.`,
      ne: `${app} · यो स्वचालित सन्देश हो, कृपया जवाफ नपठाउनुहोस्।`,
    },
    locale,
  );
}

function build(options: {
  subject: string;
  heading: string;
  paragraphs: string[];
  button?: { label: string; url: string };
  footnotes?: string[];
  tone?: 'normal' | 'alert';
  locale: Language;
}): RenderedEmail {
  const layout = {
    appName: env.APP_NAME,
    heading: options.heading,
    paragraphs: options.paragraphs,
    ...(options.button ? { button: options.button } : {}),
    ...(options.footnotes ? { footnotes: options.footnotes } : {}),
    tone: options.tone ?? ('normal' as const),
    signoff: signoff(options.locale),
  };

  return {
    subject: options.subject,
    html: renderEmailHtml(layout),
    text: renderEmailText(layout),
  };
}

/**
 * Confirm a new address.
 *
 * Sent at sign-up, before the account can be used. The tone is deliberately
 * plain: this is the first message the product ever sends, and it has to read
 * as a real service rather than a marketing blast, or it lands in spam and the
 * user never gets in.
 */
export function verifyEmailTemplate(input: {
  url: string;
  name?: string | null;
  locale?: Language;
}): RenderedEmail {
  const locale = input.locale ?? 'en';
  const app = escapeHtml(env.APP_NAME);
  const greetingName = input.name?.trim() ? escapeHtml(input.name.trim()) : null;

  return build({
    locale,
    subject: pick(
      {
        en: `Confirm your email address`,
        ne: `आफ्नो इमेल ठेगाना पुष्टि गर्नुहोस्`,
      },
      locale,
    ),
    heading: pick({ en: 'Confirm your email address', ne: 'इमेल ठेगाना पुष्टि गर्नुहोस्' }, locale),
    paragraphs: [
      pick(
        {
          en: greetingName
            ? `Welcome, ${greetingName}. One step is left before you can start using ${app}.`
            : `Welcome to ${app}. One step is left before you can start using it.`,
          ne: greetingName
            ? `स्वागत छ, ${greetingName}। ${app} प्रयोग सुरु गर्न एक कदम मात्र बाँकी छ।`
            : `${app} मा स्वागत छ। प्रयोग सुरु गर्न एक कदम मात्र बाँकी छ।`,
        },
        locale,
      ),
      pick(
        {
          en: 'Confirming your address is what lets us send rent reminders and recover your account if you ever lose access.',
          ne: 'ठेगाना पुष्टि गरेपछि हामी भाडाको सम्झना पठाउन सक्छौँ, र पहुँच गुमेमा खाता फर्काउन सकिन्छ।',
        },
        locale,
      ),
    ],
    button: {
      label: pick({ en: 'Confirm email address', ne: 'इमेल पुष्टि गर्नुहोस्' }, locale),
      url: input.url,
    },
    footnotes: [
      pick(
        {
          en: 'This link works once and expires in one hour.',
          ne: 'यो लिंक एकपटक मात्र चल्छ र एक घण्टामा समाप्त हुन्छ।',
        },
        locale,
      ),
      pick(
        {
          en: 'If you did not create this account, you can ignore this email — nothing will be set up.',
          ne: 'यदि तपाईंले यो खाता खोल्नुभएको छैन भने यो इमेल बेवास्ता गर्न सक्नुहुन्छ — कुनै खाता बन्दैन।',
        },
        locale,
      ),
    ],
  });
}

/**
 * Password reset link.
 *
 * Says plainly that nothing has changed yet. A reset email that reads as though
 * the password is already gone causes panic, and panic causes people to click
 * links in phishing mail.
 */
export function resetPasswordTemplate(input: {
  url: string;
  name?: string | null;
  locale?: Language;
}): RenderedEmail {
  const locale = input.locale ?? 'en';
  const app = escapeHtml(env.APP_NAME);
  const greetingName = input.name?.trim() ? escapeHtml(input.name.trim()) : null;

  return build({
    locale,
    subject: pick({ en: 'Reset your password', ne: 'पासवर्ड रिसेट गर्नुहोस्' }, locale),
    heading: pick({ en: 'Reset your password', ne: 'पासवर्ड रिसेट गर्नुहोस्' }, locale),
    paragraphs: [
      pick(
        {
          en: greetingName
            ? `${greetingName}, someone asked to reset the password for your ${app} account.`
            : `Someone asked to reset the password for your ${app} account.`,
          ne: greetingName
            ? `${greetingName}, तपाईंको ${app} खाताको पासवर्ड रिसेट गर्न अनुरोध आएको छ।`
            : `तपाईंको ${app} खाताको पासवर्ड रिसेट गर्न अनुरोध आएको छ।`,
        },
        locale,
      ),
      pick(
        {
          en: 'Your password has not changed yet. Open the link below on your phone to choose a new one.',
          ne: 'तपाईंको पासवर्ड अझै फेरिएको छैन। नयाँ पासवर्ड राख्न तलको लिंक फोनमा खोल्नुहोस्।',
        },
        locale,
      ),
    ],
    button: {
      label: pick({ en: 'Choose a new password', ne: 'नयाँ पासवर्ड राख्नुहोस्' }, locale),
      url: input.url,
    },
    footnotes: [
      pick(
        {
          en: 'This link works once and expires in one hour.',
          ne: 'यो लिंक एकपटक मात्र चल्छ र एक घण्टामा समाप्त हुन्छ।',
        },
        locale,
      ),
      pick(
        {
          en: 'If this was not you, ignore this email and your password will stay as it is. Nobody can change it without this link.',
          ne: 'यदि यो तपाईंले गर्नुभएको होइन भने यो इमेल बेवास्ता गर्नुहोस् — पासवर्ड जस्तै रहन्छ। यो लिंक बिना कसैले फेर्न सक्दैन।',
        },
        locale,
      ),
    ],
  });
}

/**
 * Security alert: the password was actually changed.
 *
 * Not part of the reset flow itself — sent AFTER the fact. This is the message
 * that lets a user notice a takeover they did not initiate, and it is why every
 * other session is destroyed on reset. Without it, an attacker who completes a
 * reset leaves no trace the owner would see.
 */
export function passwordChangedTemplate(input: {
  name?: string | null;
  locale?: Language;
  /** Where to go if this was not them. */
  supportUrl?: string | undefined;
}): RenderedEmail {
  const locale = input.locale ?? 'en';
  const app = escapeHtml(env.APP_NAME);
  const greetingName = input.name?.trim() ? escapeHtml(input.name.trim()) : null;

  return build({
    locale,
    tone: 'alert',
    subject: pick({ en: 'Your password was changed', ne: 'तपाईंको पासवर्ड परिवर्तन भयो' }, locale),
    heading: pick({ en: 'Your password was changed', ne: 'तपाईंको पासवर्ड परिवर्तन भयो' }, locale),
    paragraphs: [
      pick(
        {
          en: greetingName
            ? `${greetingName}, the password for your ${app} account has just been changed.`
            : `The password for your ${app} account has just been changed.`,
          ne: greetingName
            ? `${greetingName}, तपाईंको ${app} खाताको पासवर्ड भर्खर परिवर्तन भयो।`
            : `तपाईंको ${app} खाताको पासवर्ड भर्खर परिवर्तन भयो।`,
        },
        locale,
      ),
      pick(
        {
          en: 'Every other device signed in to this account has been signed out. If you made this change, there is nothing more to do.',
          ne: 'यो खातामा साइन इन भएका अन्य सबै यन्त्र साइन आउट भएका छन्। यदि यो परिवर्तन तपाईंले गर्नुभएको हो भने अरु केही गर्नुपर्दैन।',
        },
        locale,
      ),
      pick(
        {
          en: '<strong>If this was not you</strong>, reset your password immediately — whoever made this change can currently sign in.',
          ne: '<strong>यदि यो तपाईंले गर्नुभएको होइन</strong> भने तुरुन्तै पासवर्ड रिसेट गर्नुहोस् — यो परिवर्तन गर्ने व्यक्ति अहिले साइन इन गर्न सक्छ।',
        },
        locale,
      ),
    ],
    ...(input.supportUrl
      ? {
          button: {
            label: pick({ en: 'Secure my account', ne: 'खाता सुरक्षित गर्नुहोस्' }, locale),
            url: input.supportUrl,
          },
        }
      : {}),
  });
}
