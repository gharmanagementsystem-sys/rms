import { View } from 'react-native';
import { Money } from '../../../components/ui/Money';
import { Text } from '../../../components/ui/Text';
import { useSemanticColors } from '../../../theme/colors';
import type { Building2 } from '../../../components/ui/icons';

/**
 * A single figure with its label, full width.
 *
 * A row rather than a stacked half-width tile: at half width, a longer label
 * ("Collected in 30 days", or the Nepali equivalent, which typically runs
 * longer) had too little room and its value was pushed against the edge.
 * Full width gives every label room to sit on one line and the value a
 * fixed place on the right, which also keeps a column of tiles' numbers
 * aligned — helped further by `Money`'s tabular figures.
 */
export interface StatTileProps {
  label: string;
  /** Rendered as currency when given; otherwise `count` is shown. */
  amountPaisa?: number | undefined;
  count?: number | undefined;
  emphasis?: 'none' | 'owed' | 'settled';
  icon?: typeof Building2 | undefined;
}

export function StatTile({
  label,
  amountPaisa,
  count,
  emphasis = 'none',
  icon: Icon,
}: StatTileProps) {
  const colors = useSemanticColors();

  return (
    <View className="bg-surfaceElevated flex-row items-center justify-between gap-3 rounded-xl px-4 py-3">
      <View className="flex-1 flex-row items-center gap-2">
        {Icon ? <Icon size={16} color={colors.textSecondary} strokeWidth={1.75} /> : null}
        <Text variant="bodySm" tone="secondary" className="flex-1">
          {label}
        </Text>
      </View>
      {amountPaisa === undefined ? (
        <Text variant="h2" tabular>
          {count ?? 0}
        </Text>
      ) : (
        <Money amountPaisa={amountPaisa} variant="h2" emphasis={emphasis} />
      )}
    </View>
  );
}
