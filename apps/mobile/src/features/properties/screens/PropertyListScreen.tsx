import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Building2, ChevronRight, Plus } from '../../../components/ui/icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { QueryStateView } from '../../../components/ui/QueryStateView';
import { Screen } from '../../../components/ui/Screen';
import { Text } from '../../../components/ui/Text';
import { useSemanticColors } from '../../../theme/colors';
import { MIN_TOUCH_TARGET } from '../../../theme/tokens';
import { useProperties, type PropertyResponse } from '../api';

/** The landlord's properties (CLAUDE.md §10, §41, §42). */
export function PropertyListScreen() {
  const { t } = useTranslation(['properties', 'common']);
  const router = useRouter();
  const query = useProperties();

  return (
    <Screen padded={false}>
      <View className="flex-row items-center justify-between px-5 pb-2 pt-4">
        <Text variant="display">{t('properties:title')}</Text>
        {(query.data?.data.length ?? 0) > 0 ? (
          <Pressable
            onPress={() => router.push('/properties/new')}
            accessibilityRole="button"
            accessibilityLabel={t('properties:add')}
            hitSlop={12}
            className="bg-primary h-11 w-11 items-center justify-center rounded-full active:opacity-80"
          >
            <Plus size={22} color="#fff" strokeWidth={2.5} />
          </Pressable>
        ) : null}
      </View>

      <QueryStateView
        query={query}
        isEmpty={(page) => page.data.length === 0}
        empty={{
          // Says what to do next, never a bare "No data" (§42).
          title: t('properties:emptyTitle'),
          body: t('properties:emptyBody'),
          actionLabel: t('properties:add'),
          onAction: () => router.push('/properties/new'),
        }}
      >
        {(page) => (
          <ScrollView
            contentContainerClassName="px-5 pb-6 gap-3"
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
              />
            }
          >
            {page.data.map((property) => (
              <PropertyRow
                key={property.id}
                property={property}
                onPress={() => router.push(`/properties/${property.id}`)}
              />
            ))}
            <Button
              label={t('properties:add')}
              variant="secondary"
              onPress={() => router.push('/properties/new')}
              fullWidth
              className="mt-2"
            />
          </ScrollView>
        )}
      </QueryStateView>
    </Screen>
  );
}

function PropertyRow({ property, onPress }: { property: PropertyResponse; onPress: () => void }) {
  // Assembled from whichever address parts exist — a property may have only a
  // name, and §9 warns against demanding what can be supplied later.
  const location = [property.municipality, property.district].filter(Boolean).join(', ');
  const colors = useSemanticColors();

  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: MIN_TOUCH_TARGET }}>
      <Card className="flex-row items-center gap-3">
        <View className="bg-primary/10 h-10 w-10 items-center justify-center rounded-xl">
          <Building2 size={20} color={colors.primary} strokeWidth={1.75} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="body" weight="600" numberOfLines={1}>
            {property.name}
          </Text>
          {location ? (
            <Text variant="caption" tone="secondary" numberOfLines={1}>
              {location}
              {property.ward ? ` — ward ${property.ward}` : ''}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={18} color={colors.muted} />
      </Card>
    </Pressable>
  );
}
