import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Money } from '../../../components/ui/Money';
import { Text } from '../../../components/ui/Text';
import { useTheme } from '../../../theme/ThemeProvider';
import type { Wallet } from '../../../components/ui/icons';

/**
 * The one figure the screen leads with (CLAUDE.md §24, §73).
 *
 * Always the same brand colour regardless of whether the amount is owed or
 * settled — a card that swapped hue with the balance would read as a status
 * light, not a bank balance, and would fight `StatusBadge`'s icon+text+colour
 * convention (§62) for the job of signalling state. `subtitle` carries that
 * distinction instead, in words.
 *
 * This is the headline, not the whole answer: it never appears without the
 * itemised rows or breakdown that justify it elsewhere on the same screen
 * (§61) — it summarises them, it does not replace them.
 *
 * The gradient and ring are a deliberately narrow shift within the `primary`
 * hue and a single brass (`accent`) motif — not the bright multi-colour
 * gradients or repeated decoration CLAUDE.md §25 rules out. It is meant to be
 * noticed once per visit, not stared at.
 */
export interface HeroMoneyCardProps {
  icon: typeof Wallet;
  label: string;
  amountPaisa: number;
  subtitle?: ReactNode;
}

/** Mirrors `--color-primary` / `--color-accent` in global.css. Duplicated as
 *  hex, rather than read from `useSemanticColors()`, because the gradient
 *  needs a light/dark PAIR (a "from" and a "to") that token does not carry —
 *  see `theme/colors.ts` for the single-value version everything else uses. */
const PALETTE = {
  light: { from: '#14524A', to: '#0D3830', ring: '#B8863B' },
  dark: { from: '#3E8C7E', to: '#2A6157', ring: '#D4A55C' },
} as const;

export function HeroMoneyCard({ icon: Icon, label, amountPaisa, subtitle }: HeroMoneyCardProps) {
  const { resolved } = useTheme();
  const { from, to, ring } = PALETTE[resolved === 'dark' ? 'dark' : 'light'];

  return (
    <View className="overflow-hidden rounded-3xl">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="heroGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={from} />
            <Stop offset="100%" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill="url(#heroGradient)" />
        {/* One quiet ring, not a repeated pattern — the Nepali brass accent
            stays a motif (§25). */}
        <Circle
          cx="92%"
          cy="6%"
          r={64}
          stroke={ring}
          strokeOpacity={0.35}
          strokeWidth={26}
          fill="none"
        />
      </Svg>

      <View className="gap-3 p-5">
        <View className="flex-row items-center justify-between">
          <Text variant="bodySm" tone="inverse" className="opacity-80">
            {label}
          </Text>
          <View className="h-9 w-9 items-center justify-center rounded-full bg-white/15">
            <Icon size={18} color="#FFFFFF" strokeWidth={1.75} />
          </View>
        </View>

        <Money amountPaisa={amountPaisa} variant="display" tone="inverse" animate />

        {subtitle ? <View>{subtitle}</View> : null}
      </View>
    </View>
  );
}
