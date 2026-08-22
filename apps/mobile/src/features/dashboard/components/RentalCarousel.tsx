import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { RentalCardSummary } from '@rms/shared';
import { Card } from '../../../components/ui/Card';
import { Money } from '../../../components/ui/Money';
import { Text } from '../../../components/ui/Text';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { currentLanguage } from '../../../i18n';
import { CHARGE_ICON } from '../../../lib/charge-icons';
import { formatDate } from '../../../lib/calendar';
import { useDateFormat } from '../../../lib/calendar/DateFormatProvider';
import { useSemanticColors } from '../../../theme/colors';
import { Banknote, Gauge, ReceiptText } from '../../../components/ui/icons';
import { DueProgressBar } from './DueProgressBar';
import { HeroMoneyCard } from './HeroMoneyCard';

/** How long each card stays before advancing. Long enough to read the figure
 *  and the due date, short enough that five rentals cycle in well under a
 *  minute for someone who just watches rather than swiping. */
const AUTO_ADVANCE_MS = 4500;

/** How long a manual swipe suppresses auto-advance before it resumes. */
const RESUME_AFTER_MS = 3000;

/**
 * Every ACTIVE rental as its own swipeable card (CLAUDE.md §24, §25, §73).
 *
 * A single hero card can only ever lead with one rental's figures — this is
 * the fix for a user with more than one, whether they are the owner of every
 * card or the tenant on every one. It auto-advances so a user who has never
 * been told to swipe still sees that there is more than one card, but a
 * manual swipe always wins: dragging pauses the timer, and it only resumes
 * once the drag has settled.
 *
 * Auto-advance is skipped entirely under the OS reduce-motion setting (§43) —
 * manual swiping still works, only the unattended cycling stops.
 *
 * Each "page" is the hero figure PLUS that rental's charges and recent
 * payments, stacked as one tall unit — not just the hero card — so swiping to
 * a different rental moves its whole story at once rather than leaving a
 * stale breakdown on screen underneath a balance that just changed. Tapping
 * anywhere on a page still opens that rental's own detail screen, which is
 * where the FULL payment history lives (this only ever shows the most recent
 * few, per CLAUDE.md §24 — the dashboard points at things, it does not become
 * a duplicate of a full list screen).
 */
export function RentalCarousel({
  rentals,
  label,
}: {
  rentals: RentalCardSummary[];
  label: string;
}) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlatList<RentalCardSummary>>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const suppressAutoAdvance = useRef(false);

  useEffect(() => {
    if (reducedMotion || rentals.length <= 1 || cardWidth === 0) return;

    const interval = setInterval(() => {
      if (suppressAutoAdvance.current) return;
      setActiveIndex((current) => {
        const next = (current + 1) % rentals.length;
        listRef.current?.scrollToOffset({ offset: next * cardWidth, animated: true });
        return next;
      });
    }, AUTO_ADVANCE_MS);

    return () => clearInterval(interval);
  }, [reducedMotion, rentals.length, cardWidth]);

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (cardWidth === 0) return;
    const nearest = Math.round(event.nativeEvent.contentOffset.x / cardWidth);
    setActiveIndex(Math.max(0, Math.min(rentals.length - 1, nearest)));
    // Give the user a few quiet seconds before the carousel takes over again.
    setTimeout(() => {
      suppressAutoAdvance.current = false;
    }, RESUME_AFTER_MS);
  }

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RentalCardSummary>) => (
      <Pressable
        onPress={() => router.push(`/rentals/${item.rentalId}`)}
        accessibilityRole="button"
        accessibilityLabel={item.counterpartyName ?? item.placeLabel}
        style={{ width: cardWidth }}
      >
        <RentalCard rental={item} label={label} />
      </Pressable>
    ),
    [cardWidth, label, router],
  );

  return (
    <View onLayout={(event: LayoutChangeEvent) => setCardWidth(event.nativeEvent.layout.width)}>
      {cardWidth > 0 ? (
        <FlatList
          ref={listRef}
          data={rentals}
          keyExtractor={(item) => item.rentalId}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth}
          decelerationRate="fast"
          onScrollBeginDrag={() => {
            suppressAutoAdvance.current = true;
          }}
          onMomentumScrollEnd={handleMomentumEnd}
        />
      ) : null}

      {rentals.length > 1 ? (
        <View className="mt-3 flex-row justify-center gap-1.5" accessibilityElementsHidden>
          {rentals.map((rental, index) => (
            <View
              key={rental.rentalId}
              className={`h-1.5 rounded-full ${
                index === activeIndex ? 'bg-primary w-5' : 'bg-border w-1.5'
              }`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function RentalCard({ rental, label }: { rental: RentalCardSummary; label: string }) {
  const { t } = useTranslation(['dashboard', 'rentals']);
  const locale = currentLanguage();
  const { preference: format } = useDateFormat();
  const colors = useSemanticColors();

  const timing =
    rental.nextDueDate !== null && rental.daysUntilDue !== null
      ? rental.daysUntilDue < 0
        ? t('dashboard:row.daysLate', { count: Math.abs(rental.daysUntilDue) })
        : rental.daysUntilDue === 0
          ? t('dashboard:row.dueToday')
          : t('dashboard:row.dueInDays', { count: rental.daysUntilDue })
      : null;

  return (
    <View className="gap-3 px-0.5">
      <HeroMoneyCard
        icon={Banknote}
        label={label}
        amountPaisa={rental.outstandingPaisa}
        subtitle={
          <View className="gap-2">
            <Text variant="bodySm" tone="inverse" weight="600" numberOfLines={1}>
              {rental.counterpartyName ?? rental.placeLabel}
            </Text>

            {timing ? (
              <View className="gap-2">
                <DueProgressBar
                  daysUntilDue={rental.daysUntilDue ?? 0}
                  isOverdue={rental.isOverdue}
                  label={`${timing} · ${formatDate(rental.nextDueDate!, { locale, style: 'short', format })}`}
                  variant="inverse"
                />
                {!rental.chargesComplete ? (
                  <View className="flex-row items-center gap-1.5 self-start rounded-full bg-white/15 px-2.5 py-1">
                    <Gauge size={12} color="#FFFFFF" strokeWidth={2} />
                    <Text variant="caption" tone="inverse">
                      {t('dashboard:row.awaitingReading')}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text variant="caption" tone="inverse" className="opacity-80">
                {t('dashboard:renter.settledBody')}
              </Text>
            )}

            {rental.creditPaisa > 0 || rental.depositHeldPaisa > 0 ? (
              <View className="flex-row flex-wrap gap-x-4 gap-y-1 pt-1">
                {rental.creditPaisa > 0 ? (
                  <View className="flex-row items-center gap-1">
                    <Text variant="caption" tone="inverse" className="opacity-70">
                      {t('dashboard:renter.credit')}
                    </Text>
                    <Money
                      amountPaisa={rental.creditPaisa}
                      variant="caption"
                      tone="inverse"
                      weight="600"
                    />
                  </View>
                ) : null}
                {rental.depositHeldPaisa > 0 ? (
                  <View className="flex-row items-center gap-1">
                    <Text variant="caption" tone="inverse" className="opacity-70">
                      {t('dashboard:renter.deposit')}
                    </Text>
                    <Money
                      amountPaisa={rental.depositHeldPaisa}
                      variant="caption"
                      tone="inverse"
                      weight="600"
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        }
      />

      {/* Same rental, same page: this scrolls along with the hero above
          rather than staying fixed while the amount changes underneath it,
          which would otherwise leave a stale breakdown on screen the moment
          the carousel moves to a different rental. */}
      {rental.charges.length > 0 ? (
        <Card className="gap-2">
          <Text variant="h2">{t('dashboard:renter.includes')}</Text>
          {rental.charges.map((charge) => {
            const ChargeIcon = CHARGE_ICON[charge.chargeType];
            return (
              <View
                key={`${charge.chargeType}-${charge.label ?? ''}`}
                className="flex-row items-center justify-between py-1"
              >
                <View className="flex-row items-center gap-2">
                  <ChargeIcon size={16} color={colors.textSecondary} strokeWidth={1.75} />
                  <Text variant="bodySm" tone="secondary">
                    {charge.label ?? t(`dashboard:charge.${charge.chargeType}`)}
                  </Text>
                </View>
                {charge.pricingModel === 'PER_UNIT' ? (
                  <View className="flex-row items-baseline gap-1">
                    <Money
                      amountPaisa={charge.ratePaisaPerUnit ?? 0}
                      variant="bodySm"
                      weight="500"
                    />
                    <Text variant="caption" tone="secondary">
                      {t('dashboard:charge.perUnit')}
                    </Text>
                  </View>
                ) : (
                  <Money amountPaisa={charge.amountPaisa ?? 0} variant="bodySm" weight="500" />
                )}
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card className="gap-3">
        <Text variant="h2">{t('dashboard:renter.recentPayments')}</Text>
        {rental.recentPayments.length === 0 ? (
          <Text variant="bodySm" tone="secondary">
            {t('dashboard:renter.noPayments')}
          </Text>
        ) : (
          rental.recentPayments.map((payment) => (
            <View key={payment.id} className="flex-row items-center gap-3">
              <View className="bg-surfaceElevated h-9 w-9 items-center justify-center rounded-full">
                <ReceiptText size={16} color={colors.textSecondary} strokeWidth={1.75} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="bodySm">{t(`rentals:purpose.${payment.purpose}`)}</Text>
                <Text variant="caption" tone="secondary">
                  {formatDate(payment.paidOn, { locale, style: 'short', format })} ·{' '}
                  {t(`rentals:method.${payment.method}`)}
                </Text>
              </View>
              <Money amountPaisa={payment.amountPaisa} variant="bodySm" weight="600" />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
