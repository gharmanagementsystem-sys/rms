import { View } from 'react-native';
import { Text } from './Text';

/**
 * A person's initials in a tinted circle.
 *
 * No photo upload exists yet (§23), so this is the only identity mark
 * available — used wherever a screen wants to personalise itself without
 * fetching or storing an image.
 */
export interface AvatarProps {
  /** Full name; the first letters of up to the first two words are shown. */
  name: string;
  size?: number;
}

function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

export function Avatar({ name, size = 44 }: AvatarProps) {
  return (
    <View
      className="bg-primary/10 items-center justify-center rounded-full"
      style={{ width: size, height: size }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text variant="body" weight="600" tone="primary">
        {initialsOf(name)}
      </Text>
    </View>
  );
}
