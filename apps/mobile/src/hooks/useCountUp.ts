import { useEffect, useRef, useState } from 'react';
import { motion } from '../theme/tokens';

/** Starts fast and settles gently onto the final value, rather than a linear tick. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a number up to `target` whenever it changes, instead of jumping
 * straight to it — a small flourish for a headline figure such as a
 * dashboard's outstanding balance.
 *
 * Returns `target` unchanged when `enabled` is false, so a caller can gate
 * this on the OS reduce-motion setting (CLAUDE.md §25, §43) without
 * duplicating the animate/don't-animate branch in its own render logic.
 *
 * Bounded to `motion.slow` (250ms): CLAUDE.md §25 caps every animation in
 * this product at that length, so the count reads as a quick flourish rather
 * than something the user waits on.
 */
export function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(() => (enabled ? 0 : target));
  const fromRef = useRef(enabled ? 0 : target);

  useEffect(() => {
    if (!enabled) {
      fromRef.current = target;
      setValue(target);
      return;
    }

    const from = fromRef.current;
    if (from === target) return;

    const durationMs = motion.slow;
    const startedAt = Date.now();
    let frame: ReturnType<typeof requestAnimationFrame>;

    const tick = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs);
      setValue(Math.round(from + (target - from) * easeOutCubic(progress)));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled]);

  return value;
}
