import { useEffect, useRef } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Text } from '../../../components/ui/Text';
import { useCurrentUser } from '../../auth/useCurrentUser';
import { useRentals, type RentalResponse } from '../api';
import { RentalRow } from './RentalListScreen';

function myActiveRentals(rentals: RentalResponse[], userId: string | undefined): RentalResponse[] {
  return rentals.filter((rental) => rental.renterUserId === userId);
}

/**
 * Which rental is "Pay rent" for? CLAUDE.md §31, §73.
 *
 * The dashboard's hero card can only lead with one tenancy's figures, so its
 * "Pay rent" shortcut used to always send a renter to whichever rental of
 * theirs was created most recently — silently wrong the moment they have more
 * than one ACTIVE tenancy at once, since a payment could then land against the
 * wrong landlord's rent.
 *
 * This screen only ever appears when that ambiguity is real: with one active
 * rental it redirects straight past itself, and with none it explains why
 * there is nothing to pay. It asks only when asking is the honest answer.
 */
export function PayRentScreen() {
  const { t } = useTranslation(['rentals', 'common']);
  const router = useRouter();
  const { user } = useCurrentUser();
  const query = useRentals({ status: 'ACTIVE' });
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (hasRedirected.current || !query.data) return;
    const mine = myActiveRentals(query.data.data, user?.id);
    if (mine.length === 1) {
      hasRedirected.current = true;
      router.replace(`/rentals/${mine[0]!.id}/record-payment`);
    }
  }, [query.data, user?.id, router]);

  return (
    <Screen padded={false}>
      <ScreenHeader title={t('rentals:payment.choose')} showBack />
      <QueryStateView
        query={query}
        isEmpty={(page) => myActiveRentals(page.data, user?.id).length === 0}
        empty={{
          title: t('rentals:payment.noActiveTitle'),
          body: t('rentals:payment.noActiveBody'),
        }}
      >
        {(page) => {
          const mine = myActiveRentals(page.data, user?.id);
          // A single match redirects via the effect above — rendering nothing
          // here avoids a one-frame flash of a one-row picker before that
          // happens.
          if (mine.length <= 1) return null;

          return (
            <ScrollView contentContainerClassName="px-5 pb-6 gap-3">
              <Text variant="bodySm" tone="secondary">
                {t('rentals:payment.chooseHint')}
              </Text>
              {mine.map((rental) => (
                <RentalRow
                  key={rental.id}
                  rental={rental}
                  onPress={() => router.push(`/rentals/${rental.id}/record-payment`)}
                />
              ))}
            </ScrollView>
          );
        }}
      </QueryStateView>
    </Screen>
  );
}
