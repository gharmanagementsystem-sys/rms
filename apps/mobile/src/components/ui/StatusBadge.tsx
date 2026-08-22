import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, CircleDashed, CircleSlash, Clock, Gauge } from './icons';
import type { SettlementStatus } from '@rms/shared';
import { useSemanticColors } from '../../theme/colors';
import { Text } from './Text';

/**
 * Payment status. CLAUDE.md §43, §62.
 *
 * Always icon + text + colour, never colour alone. Around 1 in 12 men has some
 * form of colour-vision deficiency, and "is my rent paid?" is not a question to
 * answer with hue only.
 *
 * `isOverdue` is passed separately because it is DERIVED on the server from the
 * due date and balance rather than stored as a status (§15).
 */

export interface StatusBadgeProps {
  status: SettlementStatus;
  isOverdue?: boolean;
  /** False while a metered charge still awaits its reading — total is not final. */
  chargesComplete?: boolean;
}

type Appearance = {
  icon: typeof Check;
  tone: 'success' | 'warning' | 'danger' | 'secondary' | 'accent';
  bg: string;
  labelKey: string;
};

const APPEARANCE: Record<SettlementStatus, Appearance> = {
  PAID: { icon: Check, tone: 'success', bg: 'bg-success/10', labelKey: 'status.paid' },
  PARTIALLY_PAID: {
    icon: CircleDashed,
    tone: 'warning',
    bg: 'bg-warning/10',
    labelKey: 'status.partiallyPaid',
  },
  UNPAID: { icon: Clock, tone: 'secondary', bg: 'bg-surfaceElevated', labelKey: 'status.pending' },
  WAIVED: {
    icon: CircleSlash,
    tone: 'secondary',
    bg: 'bg-surfaceElevated',
    labelKey: 'status.waived',
  },
};

const OVERDUE: Appearance = {
  icon: AlertTriangle,
  tone: 'danger',
  bg: 'bg-danger/10',
  labelKey: 'status.overdue',
};

const AWAITING_READING: Appearance = {
  icon: Gauge,
  tone: 'accent',
  bg: 'bg-accent/10',
  labelKey: 'status.awaitingReading',
};

export function StatusBadge({
  status,
  isOverdue = false,
  chargesComplete = true,
}: StatusBadgeProps) {
  const { t } = useTranslation();
  const colors = useSemanticColors();

  // Overdue outranks the stored status: it is the thing needing action.
  const appearance = isOverdue
    ? OVERDUE
    : !chargesComplete && status !== 'PAID'
      ? AWAITING_READING
      : APPEARANCE[status];

  const Icon = appearance.icon;
  const label = t(appearance.labelKey);
  const iconColor =
    appearance.tone === 'secondary' ? colors.textSecondary : colors[appearance.tone];

  return (
    <View
      className={`${appearance.bg} flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1`}
      accessibilityRole="text"
      // One announcement rather than an icon and a label read separately.
      accessibilityLabel={label}
    >
      <Icon size={14} color={iconColor} strokeWidth={2} />
      <Text variant="caption" weight="600" tone={appearance.tone}>
        {label}
      </Text>
    </View>
  );
}
