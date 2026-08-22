import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from '../../../components/ui/icons';
import type { AttentionRow } from '@rms/shared';
import { Money } from '../../../components/ui/Money';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Text } from '../../../components/ui/Text';
import { currentLanguage } from '../../../i18n';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { DueProgressBar } from './DueProgressBar';

/**
 * One rental needing attention.
 *
 * Answers §73's four questions in a single row: what it is, how much, when it
 * is due, and — by being tappable — what to do next.
 *
 * Dates are shown in Bikram Sambat, because that is the calendar the user
 * thinks in. The AD value never reaches the screen.
 */
export function AttentionRowCard({ row, onPress }: { row: AttentionRow; onPress?: () => void }) {
  const { t } = useTranslation(['dashboard']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();

  // Whole sentences per case rather than assembled fragments — Nepali word
  // order differs and concatenation would not translate (§27).
  //
  // Branches on the SIGN of daysUntilDue, not on `isOverdue`: the due date can
  // be in the past while still inside the grace period, and `isOverdue` only
  // flips once that grace period ends. Branching on `isOverdue` here rendered
  // "Due in -3 days" for that in-between state — a negative count interpolated
  // literally instead of read as "late".
  const timing =
    row.daysUntilDue < 0
      ? t('dashboard:row.daysLate', { count: Math.abs(row.daysUntilDue) })
      : row.daysUntilDue === 0
        ? t('dashboard:row.dueToday')
        : t('dashboard:row.dueInDays', { count: row.daysUntilDue });

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${row.placeLabel}. ${timing}.`}
      style={{ minHeight: MIN_TOUCH_TARGET }}
      className="border-border gap-2 border-b py-3 last:border-b-0 active:opacity-70"
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="body" weight="600" numberOfLines={1}>
            {row.counterpartyName ?? row.placeLabel}
          </Text>
          {row.counterpartyName ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {row.placeLabel}
            </Text>
          ) : null}
        </View>

        <View className="items-end gap-1">
          <Money amountPaisa={row.balancePaisa} variant="body" weight="600" />
          {/* Not final while a meter reading is outstanding — saying so beats
              showing a total that will change (§60). */}
          {!row.chargesComplete ? (
            <StatusBadge status="PARTIALLY_PAID" chargesComplete={false} />
          ) : null}
        </View>

        {onPress ? <ChevronRight size={18} color={colors.muted} /> : null}
      </View>

      <DueProgressBar
        daysUntilDue={row.daysUntilDue}
        isOverdue={row.isOverdue}
        label={`${timing} · ${formatDate(row.dueDate, { locale, style: 'short', format })}`}
      />
    </Pressable>
  );
}
