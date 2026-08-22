import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { useTranslation } from 'react-i18next';
import { typography, type TypeScale } from '../../theme/tokens';

/**
 * The only text primitive.
 *
 * Exists to solve one problem properly: Devanagari needs more leading than
 * Latin. Matras sit above the baseline and conjuncts below it, so at Latin line
 * heights Nepali text clips and the app looks broken rather than tight (§27).
 *
 * Line height is therefore resolved from the ACTIVE LANGUAGE on every render,
 * not fixed at design time.
 */

export interface TextProps extends RNTextProps {
  variant?: TypeScale;
  /** Semantic colour token. Never a raw value (§26). */
  tone?: 'primary' | 'secondary' | 'accent' | 'success' | 'warning' | 'danger' | 'inverse';
  weight?: '400' | '500' | '600';
  /** Aligns digits in a column. Essential for money (§29). */
  tabular?: boolean;
}

const TONE_CLASS: Record<NonNullable<TextProps['tone']>, string> = {
  primary: 'text-textPrimary',
  secondary: 'text-textSecondary',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  inverse: 'text-surface',
};

export function Text({
  variant = 'body',
  tone = 'primary',
  weight,
  tabular = false,
  className = '',
  style,
  ...rest
}: TextProps) {
  const { i18n } = useTranslation();
  const scale = typography[variant];
  const isDevanagari = i18n.language === 'ne';

  return (
    <RNText
      className={`${TONE_CLASS[tone]} ${className}`}
      style={[
        {
          fontSize: scale.fontSize,
          lineHeight: isDevanagari ? scale.lineHeightDevanagari : scale.lineHeightLatin,
          fontWeight: weight ?? scale.fontWeight,
        },
        // Tabular figures keep money columns aligned; without them a list of
        // amounts visibly jitters as digits change width.
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...rest}
    />
  );
}
