import { Pressable, View } from 'react-native';
import { Check } from './icons';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import { Text } from './Text';

/**
 * A large, single-select option.
 *
 * Used where a choice is the whole point of the screen — role, theme, language.
 * Selection is shown with a check mark as well as a border, so it does not rely
 * on colour alone (§43), and the whole card is the target rather than a small
 * radio dot (§3.1 — the primary user may not be technically sophisticated).
 */
export interface ChoiceCardProps {
  label: string;
  hint?: string | undefined;
  isSelected: boolean;
  onPress: () => void;
  icon?: React.ReactNode;
}

export function ChoiceCard({ label, hint, isSelected, onPress, icon }: ChoiceCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: isSelected }}
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      style={{ minHeight: MIN_TOUCH_TARGET }}
      className={`flex-row items-center gap-3 rounded-2xl border p-4 active:opacity-80 ${
        isSelected ? 'border-primary bg-primary/5' : 'border-border bg-surface'
      }`}
    >
      {icon ? <View className="shrink-0">{icon}</View> : null}

      <View className="flex-1 gap-0.5">
        <Text variant="body" weight="600">
          {label}
        </Text>
        {hint ? (
          <Text variant="bodySm" tone="secondary">
            {hint}
          </Text>
        ) : null}
      </View>

      <View
        className={`h-6 w-6 items-center justify-center rounded-full border ${
          isSelected ? 'border-primary bg-primary' : 'border-border'
        }`}
      >
        {isSelected ? <Check size={14} color="#fff" strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}
