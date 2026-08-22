import { useEffect } from 'react';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * A placeholder block for content that has not arrived yet (CLAUDE.md §41).
 *
 * A skeleton shaped like the real layout is what makes a load feel fast —
 * the user sees the SHAPE of their data appear immediately, rather than a
 * blank page followed by a spinner followed by content. `QueryStateView` uses
 * this as its default loading state; a screen with a very distinctive layout
 * can still pass its own `skeleton` prop built from these blocks.
 *
 * The shimmer is a continuous opacity pulse rather than a sliding highlight —
 * simpler to keep smooth on a low-end Android device, and just as effective
 * at reading as "still loading" rather than "stuck". It stops entirely under
 * the OS reduce-motion setting (§43), leaving a plain static block.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 0.6 : opacity.value,
  }));

  return (
    <Animated.View
      className={`bg-surfaceElevated rounded-lg ${className}`}
      style={animatedStyle}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
