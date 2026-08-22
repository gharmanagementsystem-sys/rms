import { View } from 'react-native';
import { Text, type TextProps } from '../../../components/ui/Text';

/**
 * How many days out the bar starts filling. Not tied to the server's
 * "due soon" bucketing window (a different concern — that decides which rows
 * appear on the dashboard at all) — this only decides how full the bar looks
 * for a given `daysUntilDue`, so it can change without touching what rows the
 * server sends.
 */
const LOOKAHEAD_DAYS = 14;

export interface DueProgressBarProps {
  /** Negative once the due date has passed. */
  daysUntilDue: number;
  /** True only once the grace period has expired — the FORMAL overdue state. */
  isOverdue: boolean;
  /** The existing "due in 3 days" / "3 days late" sentence, shown under the bar. */
  label: string;
  /**
   * 'inverse' is for use on `HeroMoneyCard`, which deliberately never changes
   * colour by status — the amount card stays one brand colour regardless of
   * how urgent the payment is, and the words carry that distinction instead
   * (see the comment on `HeroMoneyCard`). 'default' is for a normal surface,
   * where the fill colour IS the primary signal.
   */
  variant?: 'default' | 'inverse';
}

/**
 * A visual read on how close a period is to its due date, in place of "due in
 * N days" as the primary signal — people scan a bar faster than they read a
 * number (hence this component), but the sentence stays underneath rather
 * than being replaced by it: colour and fill length are the only channel a bar
 * has, and CLAUDE.md §43 is explicit that a financial state must never rest on
 * colour alone.
 *
 * The bar fills from empty (`daysUntilDue >= LOOKAHEAD_DAYS`) to full (the due
 * date itself), and stays full past due — there is no ceiling on how overdue a
 * period can be, so the bar cannot keep growing to represent it. Urgency past
 * that point is carried by colour and by the label's day count instead.
 */
export function DueProgressBar({
  daysUntilDue,
  isOverdue,
  label,
  variant = 'default',
}: DueProgressBarProps) {
  const rawProgress = (LOOKAHEAD_DAYS - daysUntilDue) / LOOKAHEAD_DAYS;
  const progress = Math.max(0, Math.min(1, rawProgress));

  // "Warning" covers both "due soon" and "past due but still inside the grace
  // period" — `isOverdue` only trips once the grace period ends, and both
  // states genuinely call for more attention than "not due for a while yet".
  const urgency: 'normal' | 'warning' | 'danger' = isOverdue
    ? 'danger'
    : daysUntilDue < 7
      ? 'warning'
      : 'normal';

  const trackClass = variant === 'inverse' ? 'bg-white/15' : 'bg-surfaceElevated';
  const fillClass =
    variant === 'inverse'
      ? 'bg-white'
      : urgency === 'danger'
        ? 'bg-danger'
        : urgency === 'warning'
          ? 'bg-warning'
          : 'bg-primary';
  const textTone: NonNullable<TextProps['tone']> =
    variant === 'inverse'
      ? 'inverse'
      : urgency === 'danger'
        ? 'danger'
        : urgency === 'warning'
          ? 'warning'
          : 'secondary';

  return (
    <View className="gap-1">
      {/* Decorative: the label immediately below says the same thing in
          words, so a screen reader announcing both would be redundant. */}
      <View
        className={`h-3 w-full overflow-hidden rounded-full ${trackClass}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View
          className={`h-full rounded-full ${fillClass}`}
          style={{ width: `${progress * 100}%` }}
        />
      </View>
      <Text
        variant="caption"
        tone={textTone}
        weight="600"
        className={variant === 'inverse' ? 'opacity-80' : undefined}
      >
        {label}
      </Text>
    </View>
  );
}
