import { forwardRef, useState } from 'react';
import { Pressable, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from './icons';
import { useSemanticColors } from '../../theme/colors';
import { MIN_TOUCH_TARGET, typography } from '../../theme/tokens';
import { Text } from './Text';

/**
 * Text field. CLAUDE.md §29, §43.
 *
 * Carries the things every form needs and every form forgets: a label tied to
 * the control for screen readers, an error that is announced rather than merely
 * coloured, and a password reveal with a real touch target.
 *
 * Input is never cleared on error — losing what someone typed because the
 * server rejected one field is the fastest way to lose them (§29).
 */

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Server- or schema-supplied message. Presence also marks the field invalid. */
  error?: string | undefined;
  hint?: string | undefined;
  /** Shows a reveal toggle and disables autocorrect. */
  isPassword?: boolean;
  /** Rendered before the value, e.g. "रु" or "+977". */
  prefix?: string | undefined;
  isRequired?: boolean;
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    hint,
    isPassword = false,
    prefix,
    isRequired = false,
    /**
     * Pulled out of `rest` so it cannot silently replace the inner TextInput's
     * own classes — the same trap that made Button render invisible. Applied to
     * the outer wrapper, which is what a caller passing spacing means.
     */
    className = '',
    ...rest
  },
  ref,
) {
  const [isRevealed, setRevealed] = useState(false);
  const [isFocused, setFocused] = useState(false);
  const colors = useSemanticColors();

  const borderClass = error ? 'border-danger' : isFocused ? 'border-primary' : 'border-border';

  return (
    <View className={`gap-1.5 ${className}`}>
      <View className="flex-row items-center gap-1">
        <Text variant="bodySm" weight="500" tone="secondary">
          {label}
        </Text>
        {/* Required is marked in text, not by colour alone (§43). */}
        {isRequired ? (
          <Text variant="bodySm" tone="danger" accessibilityElementsHidden>
            *
          </Text>
        ) : null}
      </View>

      <View
        className={`bg-surface flex-row items-center rounded-xl border px-3 ${borderClass}`}
        style={{ minHeight: MIN_TOUCH_TARGET }}
      >
        {prefix ? (
          <Text variant="body" tone="secondary" className="mr-2">
            {prefix}
          </Text>
        ) : null}

        <TextInput
          ref={ref}
          accessibilityLabel={label}
          // Announces the error with the field rather than as loose text.
          accessibilityHint={error ?? hint}
          aria-invalid={Boolean(error)}
          secureTextEntry={isPassword && !isRevealed}
          autoCorrect={isPassword ? false : rest.autoCorrect}
          autoCapitalize={isPassword ? 'none' : rest.autoCapitalize}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          className="text-textPrimary flex-1 py-3"
          style={{ fontSize: typography.body.fontSize }}
          placeholderTextColor={colors.muted}
          {...rest}
        />

        {isPassword ? (
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={isRevealed ? 'Hide password' : 'Show password'}
            className="pl-2"
          >
            {isRevealed ? (
              <EyeOff size={20} color={colors.textSecondary} />
            ) : (
              <Eye size={20} color={colors.textSecondary} />
            )}
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
