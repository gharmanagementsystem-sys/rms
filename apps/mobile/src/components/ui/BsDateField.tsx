import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from './icons';
import { currentLanguage } from '../../i18n';
import {
  BS_MONTHS_EN,
  BS_MONTHS_NE,
  CalendarError,
  adToBs,
  bsToAd,
  formatBs,
  todayAd,
  toDevanagariDigits,
  type BsDate,
} from '../../lib/calendar';
import { useSemanticColors } from '../../theme/colors';
import { MIN_TOUCH_TARGET, typography } from '../../theme/tokens';
import { Text } from './Text';

/**
 * Bikram Sambat date entry. CLAUDE.md §29, §46, §47.
 *
 * BS is what a Nepali user reads and types; AD is what goes on the wire. This
 * component is the boundary between the two, and it holds that boundary in one
 * direction only — it emits AD and never lets a BS value escape upward.
 *
 * There is no native BS date picker on either platform, so entry is day, month
 * and year rather than a calendar grid. Months are named, not numbered: a
 * landlord thinks in भदौ, not "month 5". The AD equivalent is shown underneath
 * because tenancy agreements and bank slips in Nepal are often written in AD,
 * and a user reconciling the two should not have to convert in their head.
 */
export interface BsDateFieldProps {
  label: string;
  /** An AD date, `YYYY-MM-DD`. The only format this component emits. */
  value: string;
  onChange: (adDate: string) => void;
  error?: string | undefined;
  hint?: string | undefined;
  isRequired?: boolean;
}

interface DraftParts {
  year: string;
  month: number;
  day: string;
}

function partsFromAd(adDate: string): DraftParts {
  const bs: BsDate = adToBs(adDate);
  return { year: String(bs.year), month: bs.month, day: String(bs.day) };
}

/** Converts a draft back to AD, or null while it is incomplete or impossible. */
function draftToAd(parts: DraftParts): string | null {
  const year = Number(parts.year);
  const day = Number(parts.day);
  if (!Number.isInteger(year) || !Number.isInteger(day)) return null;
  if (parts.year.length !== 4 || day < 1) return null;
  try {
    return bsToAd({ year, month: parts.month, day });
  } catch (error) {
    // A day past the end of a BS month lands here — BS months run 29 to 32
    // days, so "32 Jestha" is valid and "32 Kartik" is not.
    if (error instanceof CalendarError) return null;
    throw error;
  }
}

export function BsDateField({
  label,
  value,
  onChange,
  error,
  hint,
  isRequired = false,
}: BsDateFieldProps) {
  const { t } = useTranslation(['common']);
  const locale = currentLanguage();
  const months = locale === 'ne' ? BS_MONTHS_NE : BS_MONTHS_EN;
  const colors = useSemanticColors();

  const [isOpen, setOpen] = useState(false);
  const [parts, setParts] = useState<DraftParts>(() => partsFromAd(value));
  const [localError, setLocalError] = useState<string | undefined>();

  /**
   * Resync the draft when the value changes from outside.
   *
   * Adjusting state during render rather than in an effect, which is React's
   * documented pattern for exactly this: an effect would render once with the
   * stale draft before correcting it, and would need a dependency list that
   * lies about what it reads. Comparing against the last seen prop means a
   * half-typed year — which produces no AD date and so no `onChange` — is left
   * alone rather than being reset mid-keystroke.
   */
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setParts(partsFromAd(value));
  }

  function commit(next: DraftParts) {
    setParts(next);
    const ad = draftToAd(next);
    if (ad) {
      setLocalError(undefined);
      onChange(ad);
    } else {
      // Incomplete entry is not an error yet — only a complete, impossible one.
      setLocalError(
        next.year.length === 4 && next.day.length > 0
          ? t('common:date.invalidForMonth')
          : undefined,
      );
    }
  }

  const shownError = error ?? localError;
  const borderClass = shownError ? 'border-danger' : isOpen ? 'border-primary' : 'border-border';

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-1">
        <Text variant="bodySm" weight="500" tone="secondary">
          {label}
        </Text>
        {isRequired ? (
          <Text variant="bodySm" tone="danger" accessibilityElementsHidden>
            *
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={() => setOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${formatBs(value, { locale })}`}
        accessibilityState={{ expanded: isOpen }}
        style={{ minHeight: MIN_TOUCH_TARGET }}
        className={`bg-surface flex-row items-center gap-3 rounded-xl border px-3 ${borderClass}`}
      >
        <CalendarDays size={20} color={colors.textSecondary} strokeWidth={1.75} />
        <View className="flex-1 py-2.5">
          <Text variant="body">{formatBs(value, { locale })}</Text>
          {/* The AD equivalent, because agreements and bank records use it. */}
          <Text variant="caption" tone="secondary">
            {t('common:date.adEquivalent', { date: value })}
          </Text>
        </View>
        <Text variant="caption" tone="accent" weight="600">
          {isOpen ? t('common:actions.close') : t('common:actions.change')}
        </Text>
      </Pressable>

      {isOpen ? (
        <View className="border-border bg-surface gap-3 rounded-xl border p-3">
          <View className="flex-row items-end gap-3">
            <NumberBox
              label={t('common:date.day')}
              value={parts.day}
              maxLength={2}
              onChangeText={(text) => commit({ ...parts, day: text.replace(/\D/g, '') })}
            />
            <NumberBox
              label={t('common:date.year')}
              value={parts.year}
              maxLength={4}
              onChangeText={(text) => commit({ ...parts, year: text.replace(/\D/g, '') })}
            />
            <Pressable
              onPress={() => {
                const today = todayAd();
                setParts(partsFromAd(today));
                setLocalError(undefined);
                onChange(today);
              }}
              accessibilityRole="button"
              hitSlop={8}
              style={{ minHeight: MIN_TOUCH_TARGET }}
              className="border-border justify-center rounded-lg border px-3 active:opacity-70"
            >
              <Text variant="bodySm" weight="600" tone="accent">
                {t('common:date.today')}
              </Text>
            </Pressable>
          </View>

          <View className="gap-2">
            <Text variant="caption" tone="secondary">
              {t('common:date.month')}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {months.map((name, index) => {
                const month = index + 1;
                const isSelected = parts.month === month;
                return (
                  <Pressable
                    key={name}
                    onPress={() => commit({ ...parts, month })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={name}
                    className={`rounded-lg border px-3 py-2 active:opacity-70 ${
                      isSelected ? 'border-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    <Text
                      variant="bodySm"
                      weight={isSelected ? '600' : '400'}
                      tone={isSelected ? 'accent' : 'secondary'}
                    >
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ) : null}

      {shownError ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {shownError}
        </Text>
      ) : hint ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A compact numeric box.
 *
 * Local rather than shared: `Input` is a full-width labelled field, and a
 * two-character day box is a genuinely different visual pattern, not the same
 * one reused (§53).
 */
function NumberBox({
  label,
  value,
  maxLength,
  onChangeText,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChangeText: (text: string) => void;
}) {
  const isNepali = currentLanguage() === 'ne';
  const colors = useSemanticColors();

  return (
    <View className="gap-1">
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <View
        className="border-border bg-background rounded-lg border px-3"
        style={{ minHeight: MIN_TOUCH_TARGET, minWidth: maxLength > 2 ? 84 : 60 }}
      >
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={maxLength}
          className="text-textPrimary flex-1"
          style={{ fontSize: typography.body.fontSize }}
          // Digits are entered in Western form regardless of locale, because
          // number-pad keyboards produce them; the display elsewhere converts.
          placeholder={isNepali ? toDevanagariDigits('0') : '0'}
          placeholderTextColor={colors.muted}
        />
      </View>
    </View>
  );
}
