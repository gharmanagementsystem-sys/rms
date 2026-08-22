import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Whether the OS "reduce motion" accessibility setting is on.
 *
 * Decorative animation must be skipped for a user who asked their device to
 * minimise motion (CLAUDE.md §25, §43) — this is the one place that reads the
 * setting, so a screen only has to branch on the boolean it returns rather
 * than each animated component polling `AccessibilityInfo` itself.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
