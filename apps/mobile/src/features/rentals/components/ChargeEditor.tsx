import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChargeType } from '@rms/shared';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { MoneyInput } from '../../../components/ui/MoneyInput';
import { SegmentedChoice } from '../../../components/ui/SegmentedChoice';
import { Text } from '../../../components/ui/Text';
import { CHARGE_ICON } from '../../../lib/charge-icons';
import { useSemanticColors } from '../../../theme/colors';
import { METERABLE_CHARGE_TYPES, type ChargeDraft } from '../charge-draft';

/**
 * One configurable charge. CLAUDE.md §12, §53.
 *
 * Everything except rent is opt-in, and the fields for a charge only appear
 * once it is switched on — §3.1 asks for progressive disclosure rather than a
 * dense form showing eleven inputs a landlord does not need.
 */
export interface ChargeEditorProps {
  chargeType: ChargeType;
  draft: ChargeDraft;
  onChange: (draft: ChargeDraft) => void;
  /** Already-translated. Empty when the charge is fine. */
  error?: string | undefined;
  /** Rent cannot be switched off — a rental without it is not a rental. */
  isLocked?: boolean;
}

export function ChargeEditor({
  chargeType,
  draft,
  onChange,
  error,
  isLocked = false,
}: ChargeEditorProps) {
  const { t } = useTranslation(['rentals']);
  const colors = useSemanticColors();

  const name = t(`rentals:charge.${chargeType}`);
  const canBeMetered = METERABLE_CHARGE_TYPES.includes(chargeType);
  const isMetered = draft.pricingModel === 'PER_UNIT';
  const Icon = CHARGE_ICON[chargeType];

  return (
    <Card className="gap-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-3">
          <View className="bg-primary/10 h-10 w-10 items-center justify-center rounded-full">
            <Icon size={18} color={colors.primary} strokeWidth={1.75} />
          </View>
          <View className="flex-1">
            <Text variant="body" weight="600">
              {name}
            </Text>
            {isLocked ? (
              <Text variant="caption" tone="secondary">
                {t('rentals:charge.rentAlwaysIncluded')}
              </Text>
            ) : null}
          </View>
        </View>

        {isLocked ? null : (
          <Switch
            value={draft.isEnabled}
            onValueChange={(isEnabled) => onChange({ ...draft, isEnabled })}
            accessibilityLabel={name}
            accessibilityRole="switch"
          />
        )}
      </View>

      {draft.isEnabled ? (
        <View className="gap-3">
          {chargeType === 'OTHER' ? (
            <Input
              label={t('rentals:charge.nameLabel')}
              placeholder={t('rentals:charge.namePlaceholder')}
              value={draft.label}
              onChangeText={(label) => onChange({ ...draft, label })}
              isRequired
              maxLength={60}
            />
          ) : null}

          {canBeMetered ? (
            <SegmentedChoice
              label={t('rentals:charge.howCharged')}
              options={[
                { value: 'PER_UNIT', label: t('rentals:charge.perUnit') },
                { value: 'FIXED', label: t('rentals:charge.flatRate') },
              ]}
              value={draft.pricingModel}
              onChange={(pricingModel) => onChange({ ...draft, pricingModel })}
            />
          ) : null}

          {isMetered ? (
            <MoneyInput
              label={t('rentals:charge.rateLabel')}
              value={draft.rateText}
              onChangeText={(rateText) => onChange({ ...draft, rateText })}
              error={error}
              unitHint={t('rentals:charge.rateHint')}
              isRequired
            />
          ) : (
            <MoneyInput
              label={t('rentals:charge.amountLabel')}
              value={draft.amountText}
              onChangeText={(amountText) => onChange({ ...draft, amountText })}
              error={error}
              unitHint={t('rentals:charge.amountHint')}
              isRequired
            />
          )}

          {/* Per-charge proration. Only fixed charges have one: a meter already
              measures actual usage, so prorating it would discount twice. */}
          {isMetered ? (
            <Text variant="caption" tone="secondary">
              {t('rentals:charge.meteredProrationNote')}
            </Text>
          ) : (
            <SegmentedChoice
              label={t('rentals:charge.ifTenantLeavesMidPeriod')}
              options={[
                { value: 'PRORATE', label: t('rentals:charge.prorate') },
                { value: 'FULL', label: t('rentals:charge.chargeFull') },
              ]}
              value={draft.prorationPolicy}
              onChange={(prorationPolicy) => onChange({ ...draft, prorationPolicy })}
            />
          )}
        </View>
      ) : null}
    </Card>
  );
}
