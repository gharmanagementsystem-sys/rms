import { forwardRef } from 'react';
import type { TextInput } from 'react-native';
import { Input, type InputProps } from './Input';

/**
 * A rupee amount field. CLAUDE.md §29 — show the unit, use the right keyboard.
 *
 * Thin on purpose: it fixes the keyboard, shows रु, and stops obviously invalid
 * keystrokes. It does NOT convert to paisa — the screen does that on submit via
 * `parseRupeesToPaisa`, so a half-typed "15." is never silently reinterpreted
 * while the user is still typing.
 */
export interface MoneyInputProps extends Omit<InputProps, 'prefix' | 'keyboardType'> {
  /** Shown after the field, e.g. "per unit" or "per period". */
  unitHint?: string | undefined;
}

export const MoneyInput = forwardRef<TextInput, MoneyInputProps>(function MoneyInput(
  { onChangeText, unitHint, hint, ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      prefix="रु"
      // decimal-pad rather than numeric: numeric offers a minus sign on Android,
      // and a negative rent is not a thing.
      keyboardType="decimal-pad"
      inputMode="decimal"
      hint={unitHint ?? hint}
      onChangeText={(text) => {
        // Keeps digits, a single decimal point, and Devanagari numerals. Letters
        // and signs are dropped as they are typed rather than failing later.
        const cleaned = text.replace(/[^\d.,\s०-९]/g, '');
        onChangeText?.(cleaned);
      }}
      {...rest}
    />
  );
});
