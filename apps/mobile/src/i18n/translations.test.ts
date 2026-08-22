import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the translation layer against the failure mode it actually suffered:
 * a key that renders as its own name on screen.
 *
 * Two real bugs motivated this file, both of which shipped and both of which a
 * user hit before anyone noticed:
 *
 *  1. `t('settings.language')` inside a screen whose default namespace was
 *     `onboarding`. i18next cannot find it, so it renders the literal string
 *     "settings.language" — which is what appeared on the onboarding screen.
 *  2. `t('auth.errors.network')` with a DOT where a COLON belongs. The key
 *     exists at auth.json → errors.network, but `auth.errors.network` resolves
 *     against the default namespace and fails, so every authentication failure
 *     showed the user a raw key instead of a sentence.
 *
 * Neither is a type error, neither fails at build time, and neither shows up in
 * a test that renders nothing. Only reading the call sites catches them.
 */

const I18N_DIR = join(__dirname);
const SRC_DIR = join(__dirname, '..');
const LOCALES = ['en', 'ne'] as const;

type Bundle = Record<string, unknown>;

function loadLocale(locale: string): Record<string, Bundle> {
  const dir = join(I18N_DIR, locale);
  const bundles: Record<string, Bundle> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    bundles[file.replace('.json', '')] = JSON.parse(
      readFileSync(join(dir, file), 'utf8'),
    ) as Bundle;
  }
  return bundles;
}

function lookup(bundle: Bundle | undefined, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node === undefined || node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[part];
  }, bundle);
}

/**
 * i18next plural suffixes.
 *
 * A pluralised entry is stored as `key_one` / `key_other` and there is no bare
 * `key`, so a resolver that only looks for the literal name reports a working
 * translation as broken.
 */
const PLURAL_SUFFIXES = ['_other', '_one', '_zero', '_two', '_few', '_many'] as const;

function resolve(bundle: Bundle | undefined, key: string): unknown {
  const direct = lookup(bundle, key);
  if (direct !== undefined) return direct;

  for (const suffix of PLURAL_SUFFIXES) {
    const plural = lookup(bundle, `${key}${suffix}`);
    if (plural !== undefined) return plural;
  }
  return undefined;
}

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

const en = loadLocale('en');
const files = sourceFiles(SRC_DIR);

interface Call {
  file: string;
  key: string;
  defaultNs: string;
}

/** Every literal `t('…')` in the app, with the namespace it resolves against. */
function collectCalls(): Call[] {
  const calls: Call[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');

    // The first namespace passed to useTranslation becomes the default for
    // every bare key in that file — which is the subtlety behind bug 1.
    const declared = /useTranslation\(\[([^\]]*)\]/.exec(source);
    const defaultNs = declared
      ? (declared[1]?.split(',')[0]?.trim().replace(/['"]/g, '') ?? 'common')
      : 'common';

    for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
      const key = match[1];
      // Template-literal keys are dynamic and cannot be checked statically.
      if (!key || key.includes('${')) continue;
      calls.push({ file: file.replace(SRC_DIR, ''), key, defaultNs });
    }
  }

  return calls;
}

const calls = collectCalls();

describe('translation call sites', () => {
  it('finds t() calls to check', () => {
    // A guard on the guard: if the regex silently stops matching, this file
    // would pass while checking nothing.
    expect(calls.length).toBeGreaterThan(100);
  });

  it('every literal key resolves to a real string', () => {
    const broken = calls.filter((call) => {
      const [ns, rest] = call.key.includes(':')
        ? (call.key.split(':') as [string, string])
        : [call.defaultNs, call.key];
      return typeof resolve(en[ns], rest) !== 'string';
    });

    expect(broken.map((c) => `${c.file}: t('${c.key}') [default ns: ${c.defaultNs}]`)).toEqual([]);
  });

  it('never uses a dot where a namespace separator belongs', () => {
    // `t('auth.errors.network')` is the shape of bug 2: it looks right, and it
    // silently renders the key. If the first segment names a real namespace,
    // the separator should have been a colon.
    const namespaces = new Set(Object.keys(en));
    const suspicious = calls.filter((call) => {
      if (call.key.includes(':')) return false;
      const firstSegment = call.key.split('.')[0];
      return firstSegment !== undefined && namespaces.has(firstSegment);
    });

    expect(suspicious.map((c) => `${c.file}: t('${c.key}')`)).toEqual([]);
  });
});

describe('translation bundles', () => {
  it('has the same namespaces in every locale', () => {
    const enNamespaces = Object.keys(en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(loadLocale(locale)).sort()).toEqual(enNamespaces);
    }
  });

  it('has no key present in English but missing in Nepali', () => {
    // A missing Nepali key falls back to English, which is a silent
    // half-translated screen rather than a visible failure (§27).
    const ne = loadLocale('ne');
    const missing: string[] = [];

    const walk = (enNode: unknown, neNode: unknown, path: string): void => {
      if (typeof enNode === 'string') {
        if (typeof neNode !== 'string') missing.push(path);
        return;
      }
      if (enNode === null || typeof enNode !== 'object') return;
      for (const [key, value] of Object.entries(enNode)) {
        walk(
          value,
          neNode && typeof neNode === 'object'
            ? (neNode as Record<string, unknown>)[key]
            : undefined,
          path ? `${path}.${key}` : key,
        );
      }
    };

    for (const namespace of Object.keys(en)) {
      walk(en[namespace], ne[namespace], namespace);
    }

    expect(missing).toEqual([]);
  });

  it('has no empty translation strings', () => {
    const empty: string[] = [];
    for (const locale of LOCALES) {
      const bundles = loadLocale(locale);
      const walk = (node: unknown, path: string): void => {
        if (typeof node === 'string') {
          if (node.trim().length === 0) empty.push(`${locale}:${path}`);
          return;
        }
        if (node === null || typeof node !== 'object') return;
        for (const [key, value] of Object.entries(node)) {
          walk(value, path ? `${path}.${key}` : key);
        }
      };
      for (const namespace of Object.keys(bundles)) walk(bundles[namespace], namespace);
    }
    expect(empty).toEqual([]);
  });
});
