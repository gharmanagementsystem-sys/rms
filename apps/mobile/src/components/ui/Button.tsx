import { ActivityIndicator, Pressable, View, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { MIN_TOUCH_TARGET, motion } from '../../theme/tokens';
import { Text } from './Text';

/**
 * The only button primitive (CLAUDE.md §43, §53).
 *
 * Carries its own busy state so no screen re-implements "disable and show a
 * spinner", and enforces the minimum touch target rather than leaving it to
 * each caller to remember.
 *
 * The press-in scale is the one animation every button in the app shares —
 * short, physical, and consistent (§25) — rather than each screen inventing
 * its own tap feedback or relying on `active:opacity` alone.
 */

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** How far a button compresses on press. Subtle enough to read as "physical
 *  material responding to touch", not a bounce effect. */
const PRESS_SCALE = 0.97;

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and blocks presses. */
  isBusy?: boolean;
  fullWidth?: boolean;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-primary',
  secondary: 'bg-surfaceElevated border border-border',
  ghost: 'bg-transparent',
  danger: 'bg-danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 rounded-lg',
  md: 'px-4 py-3 rounded-xl',
  lg: 'px-5 py-4 rounded-2xl',
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  isBusy = false,
  fullWidth = false,
  disabled,
  /**
   * MUST be destructured, not left in `rest`.
   *
   * Spreading `rest` after `className` replaces the computed class string
   * outright rather than adding to it — so `<Button className="mt-1" />` lost
   * its background, padding and width, and rendered as white label text on the
   * page background. It looked like the button was missing entirely.
   *
   * Merging it last also keeps the caller's class the winning one for any
   * property both set, which is what a caller passing a margin expects.
   */
  className = '',
  // Also pulled out rather than left in `rest`: the press animation below
  // needs to run alongside whatever a caller supplies, not be replaced by it.
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled === true || isBusy;
  const usesInverseText = variant === 'primary' || variant === 'danger';
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      accessibilityRole="button"
      // The label is announced even while busy, so a screen reader user is not
      // left with an unlabelled control (§43).
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: isBusy }}
      disabled={isDisabled}
      // Guarantees a reliable tap area regardless of the label's size.
      hitSlop={8}
      {...rest}
      onPressIn={(event) => {
        if (!reducedMotion) scale.value = withTiming(PRESS_SCALE, { duration: motion.fast });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        if (!reducedMotion) scale.value = withTiming(1, { duration: motion.fast });
        onPressOut?.(event);
      }}
      style={[
        { minHeight: MIN_TOUCH_TARGET, opacity: isDisabled ? 0.55 : 1 },
        reducedMotion ? null : animatedStyle,
      ]}
      className={`${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${fullWidth ? 'w-full' : ''} items-center justify-center ${className}`}
    >
      <View className="flex-row items-center gap-2">
        {isBusy ? (
          <ActivityIndicator size="small" color={usesInverseText ? '#fff' : undefined} />
        ) : null}
        <Text
          variant={size === 'sm' ? 'bodySm' : 'body'}
          weight="600"
          tone={usesInverseText ? 'inverse' : variant === 'ghost' ? 'accent' : 'primary'}
        >
          {label}
        </Text>
      </View>
    </AnimatedPressable>
  );
}
