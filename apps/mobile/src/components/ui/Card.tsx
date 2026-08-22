import { View, type ViewProps } from 'react-native';
import { elevation } from '../../theme/tokens';

/**
 * Surface container.
 *
 * Uses semantic tokens so dark mode is a palette swap rather than a second set
 * of styles, and supplies both iOS shadow props and Android elevation — each
 * platform ignores the other's, so a card would otherwise render flat on one.
 */
export interface CardProps extends ViewProps {
  /** 'low' for list rows, 'medium' for something that should lift off the page. */
  depth?: 'none' | 'low' | 'medium';
  padded?: boolean;
}

export function Card({ depth = 'low', padded = true, className = '', style, ...rest }: CardProps) {
  return (
    <View
      className={`bg-surface border-border rounded-2xl border ${padded ? 'p-4' : ''} ${className}`}
      style={[elevation[depth], style]}
      {...rest}
    />
  );
}
