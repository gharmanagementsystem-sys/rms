import { Component, type ReactNode } from 'react';
import { Appearance, Pressable, Text, View } from 'react-native';
import { i18n } from '../../i18n';

/**
 * The last line of defence against a blank screen. CLAUDE.md §40, §71.
 *
 * Without a boundary, one uncaught render error unmounts the entire React
 * tree and leaves a white screen that no amount of tapping recovers — the
 * user's only option is to force-quit. For an app people trust with rent
 * records, silently disappearing is the worst possible failure mode.
 *
 * DELIBERATELY DEPENDENCY-FREE. This component uses no context, no hooks and
 * none of the app's own UI kit:
 *
 *  • `ThemeProvider` / `DateFormatProvider` context is not read, because a
 *    crash inside a provider is exactly the case this must survive — a
 *    fallback that consumed the broken context would throw again while
 *    rendering, and an error thrown by an error boundary's own fallback has
 *    nothing above it to catch it.
 *  • `Text` / `Button` from `components/ui` are not used for the same reason,
 *    since both read theme context.
 *  • Colours are literal, taken from `theme/colors.ts`, resolved through
 *    `Appearance` (a plain RN module, no provider).
 *  • Translation goes through the i18n singleton rather than `useTranslation`,
 *    wrapped in try/catch with an English default, so a failure in i18n
 *    itself still yields a readable screen rather than a second crash. This
 *    is the one deliberate exception to §27's "never hard-code a string": the
 *    hard-coded text is a fallback that only appears if the translation layer
 *    is the thing that broke.
 */

/** Mirrors `background`/`textPrimary`/`textSecondary`/`primary` in
 *  `theme/colors.ts`. Duplicated as literals rather than imported through
 *  `useSemanticColors()` because that hook requires ThemeProvider context. */
const PALETTE = {
  light: {
    background: '#FAF8F5',
    textPrimary: '#1A1F1D',
    textSecondary: '#5C625F',
    primary: '#14524A',
  },
  dark: {
    background: '#121413',
    textPrimary: '#F0EEE9',
    textSecondary: '#A8ADA9',
    primary: '#3E8C7E',
  },
} as const;

/** Reads a string from i18n, falling back to English if i18n is unavailable. */
function translate(key: string, fallback: string): string {
  try {
    const value = i18n.t(key, { defaultValue: fallback });
    return typeof value === 'string' && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown instead of the default screen. For a boundary around one feature. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    /**
     * The single place a render crash is reported.
     *
     * `console.error` reaches Metro in development and is a no-op the user
     * never sees in production. When a crash reporter is added (Sentry,
     * Crashlytics), this is the one call site to change — nothing else in
     * the app needs to know about it.
     */
    console.error('Unhandled render error', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    const colors = PALETTE[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'];

    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 8,
          backgroundColor: colors.background,
        }}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: '600',
            color: colors.textPrimary,
            textAlign: 'center',
          }}
        >
          {translate('common:states.errorTitle', 'Something went wrong')}
        </Text>

        <Text style={{ fontSize: 14, color: colors.textSecondary, textAlign: 'center' }}>
          {translate(
            'common:states.crashBody',
            'The app ran into an unexpected problem. Your saved records are safe.',
          )}
        </Text>

        <Pressable
          onPress={this.reset}
          accessibilityRole="button"
          // 44pt is the minimum comfortable touch target on both platforms
          // (§43); `theme/tokens` is not imported here to keep this file free
          // of app dependencies.
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: 24,
            marginTop: 8,
            borderRadius: 12,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>
            {translate('common:actions.retry', 'Try again')}
          </Text>
        </Pressable>
      </View>
    );
  }
}
