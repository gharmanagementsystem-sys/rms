import { KeyboardAvoidingView, Platform, ScrollView, View, type ViewProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

/**
 * Page container. CLAUDE.md §3.4, §29.
 *
 * Solves the two layout problems every mobile form hits, once:
 *
 *  • Safe areas — notches and home indicators differ per device, and content
 *    under them is unreadable or untappable.
 *  • Keyboard overlap — iOS and Android need different strategies, and a field
 *    hidden behind the keyboard is a form nobody can finish.
 */

/** Casts UPWARD, unlike every other shadow in `theme/tokens.ts` — a footer
 *  bar sits on top of the content behind it, not on the page underneath it. */
const FOOTER_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.06,
  shadowRadius: 6,
  elevation: 8,
};
export interface ScreenProps extends ViewProps {
  /** Wraps content in a ScrollView. Required for anything taller than a phone. */
  scrollable?: boolean;
  /** Adds standard page padding. */
  padded?: boolean;
  edges?: readonly Edge[];
  /** Pinned to the bottom, outside the scroll area — for a primary action. */
  footer?: React.ReactNode;
}

export function Screen({
  scrollable = false,
  padded = true,
  edges = ['top', 'left', 'right'],
  footer,
  children,
  className = '',
  ...rest
}: ScreenProps) {
  const body = scrollable ? (
    <ScrollView
      contentContainerClassName={padded ? 'p-5 gap-4' : undefined}
      keyboardShouldPersistTaps="handled"
      // Lets the user dismiss the keyboard by scrolling, which is what they
      // instinctively try when a field is covered.
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View className={`flex-1 ${padded ? 'gap-4 p-5' : ''}`}>{children}</View>
  );

  return (
    <SafeAreaView className={`bg-background flex-1 ${className}`} edges={edges} {...rest}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        // 'padding' is correct on iOS; on Android the OS already resizes the
        // window, and adding padding there double-counts and jumps the layout.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        {footer ? (
          // A hairline border alone reads as flat; a lifted edge is what
          // tells the eye this bar floats above the content rather than
          // being just another row of it (§25).
          <SafeAreaView
            edges={['bottom']}
            className="bg-background border-border border-t"
            style={FOOTER_SHADOW}
          >
            <View className="px-5 pb-2 pt-3">{footer}</View>
          </SafeAreaView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
