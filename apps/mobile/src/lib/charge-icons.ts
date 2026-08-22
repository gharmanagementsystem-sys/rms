import type { ChargeType } from '@rms/shared';
import {
  Banknote,
  Droplet,
  Layers,
  Sparkles,
  Trash2,
  Wifi,
  Zap,
  type Bell,
} from '../components/ui/icons';

/**
 * One icon per charge type (CLAUDE.md §25, §61).
 *
 * Shared between the charge-configuration screen and every place a charge
 * breakdown is displayed, so "electricity" always carries the same glyph
 * rather than each screen picking its own.
 */
export const CHARGE_ICON: Record<ChargeType, typeof Bell> = {
  RENT: Banknote,
  ELECTRICITY: Zap,
  WATER: Droplet,
  INTERNET: Wifi,
  WASTE: Trash2,
  CLEANING: Sparkles,
  OTHER: Layers,
};
