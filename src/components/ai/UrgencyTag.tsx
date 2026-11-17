import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export type UrgencyLevel = 'Routine' | 'Soon' | 'Urgent';

export interface UrgencyTagProps {
  urgency: UrgencyLevel;
  style?: ViewStyle;
}

const URGENCY_CONFIG: Record<
  UrgencyLevel,
  { bg: string; text: string; border: string }
> = {
  Routine: {
    bg: colors.infoSoft,
    text: colors.info,
    border: '#D9DCFE',
  },
  Soon: {
    bg: colors.warningSoft,
    text: '#B45309',
    border: '#FDE68A',
  },
  Urgent: {
    bg: colors.dangerSoft,
    text: '#DC2626',
    border: '#FECACA',
  },
};

/**
 * Small urgency tag used on doctor appointment list rows and detail headers.
 * Uses high-contrast, accessible tone colors.
 */
export function UrgencyTag({ urgency, style }: UrgencyTagProps) {
  const config = URGENCY_CONFIG[urgency] ?? URGENCY_CONFIG.Routine;

  return (
    <View
      style={[
        styles.tag,
        { backgroundColor: config.bg, borderColor: config.border },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Urgency level: ${urgency}`}
    >
      <View style={[styles.dot, { backgroundColor: config.text }]} />
      <Text style={[styles.label, { color: config.text }]}>{urgency}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
    minHeight: 24,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
});
