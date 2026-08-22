import { Pressable, View } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import { Text } from './Text';

/**
 * A single-select row of options. CLAUDE.md §29, §43, §53.
 *
 * Replaces the `<View className="flex-row gap-2">` + several `<Button>` pattern
 * that had spread through the app. Those buttons sized to their labels with no
 * width constraint, so a pair like "Charge for the days used" / "Charge the
 * full amount" simply ran past the edge of its card. Every one of those rows
 * was one long translation away from the same bug — and Nepali is frequently
 * longer than English, so the risk was not hypothetical.
 *
 * Here the options share the row (`flex-1`) and their labels wrap, so the
 * control gets taller rather than wider and can never overflow its parent.
 *
 * Selection is conveyed by border, weight AND a filled background — never by
 * colour alone (§43) — and the group is announced as a radiogroup so a screen
 * reader user hears "2 of 2 selected" rather than two unrelated buttons.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedChoiceProps<T extends string> {
  /** Rendered above the row. Also becomes the group's accessible name. */
  label?: string | undefined;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Explanatory text under the row. */
  hint?: string | undefined;
  disabled?: boolean;
}

export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  hint,
  disabled = false,
}: SegmentedChoiceProps<T>) {
  return (
    <View className="gap-2">
      {label ? (
        <Text variant="bodySm" weight="500" tone="secondary">
          {label}
        </Text>
      ) : null}

      <View className="flex-row gap-2" accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const isSelected = option.value === value;

          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={option.label}
              // flex-1 is the whole point: the options divide the available
              // width instead of demanding their natural width.
              className={`flex-1 items-center justify-center rounded-xl border px-3 py-2.5 active:opacity-80 ${
                isSelected ? 'border-primary bg-primary' : 'border-border bg-surface'
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET, opacity: disabled ? 0.55 : 1 }}
            >
              <Text
                variant="bodySm"
                weight={isSelected ? '600' : '400'}
                tone={isSelected ? 'inverse' : 'primary'}
                className="text-center"
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
