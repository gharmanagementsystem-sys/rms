import { formatAmount, paisa } from '@rms/shared';
import { useCountUp } from '../../hooks/useCountUp';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { currentLanguage } from '../../i18n';
import { Text, type TextProps } from './Text';

/**
 * A monetary amount.
 *
 * Always tabular so columns of figures align — without it a list of amounts
 * visibly jitters as digits change width, which reads as sloppy on a screen
 * about someone's money (§29).
 *
 * Grouping is South Asian: 1,50,000 — not 150,000. Nepali speakers see
 * Devanagari numerals.
 */
export interface MoneyProps extends Omit<TextProps, 'children' | 'tabular'> {
  amountPaisa: number;
  /** Hides the रु symbol, for use in a labelled column. */
  withSymbol?: boolean;
  /** Colours the value by sign of obligation, not by arithmetic sign. */
  emphasis?: 'none' | 'owed' | 'settled';
  /**
   * Counts up to the amount instead of rendering it immediately — a small
   * flourish reserved for a headline figure (a dashboard hero card), not for
   * money in a list or table where it would be distracting. Skipped
   * automatically when the OS reduce-motion setting is on (§43).
   */
  animate?: boolean;
}

export function Money({
  amountPaisa,
  withSymbol = true,
  emphasis = 'none',
  tone,
  animate = false,
  ...rest
}: MoneyProps) {
  const isNepali = currentLanguage() === 'ne';
  const reducedMotion = useReducedMotion();
  const displayedPaisa = useCountUp(amountPaisa, animate && !reducedMotion);

  const resolvedTone =
    tone ?? (emphasis === 'owed' ? 'danger' : emphasis === 'settled' ? 'success' : 'primary');

  return (
    <Text tone={resolvedTone} tabular {...rest}>
      {formatAmount(paisa(displayedPaisa), { withSymbol, devanagariDigits: isNepali })}
    </Text>
  );
}
