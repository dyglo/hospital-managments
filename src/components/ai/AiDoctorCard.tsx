import React from 'react';
import { View, StyleSheet, Pressable, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar, Text, Button } from '@/components/ui';
import { colors, radius, spacing, shadows } from '@/theme';

export interface AiDoctorCardProps {
  id: string;
  name: string;
  specialty: string;
  nextSlot: string;
  photoURL?: string | null;
  onBook: () => void;
  style?: ViewStyle;
}

export function AiDoctorCard({
  name,
  specialty,
  nextSlot,
  photoURL,
  onBook,
  style,
}: AiDoctorCardProps) {
  return (
    <View style={[styles.card, shadows.sm, style]}>
      <View style={styles.topRow}>
        <Avatar name={name} uri={photoURL} size={48} />
        <View style={styles.info}>
          <Text variant="h3" numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.specialty} numberOfLines={1}>
            {specialty}
          </Text>
        </View>
      </View>

      <View style={styles.bottomRow}>
        <View style={styles.slotContainer}>
          <Ionicons name="calendar-outline" size={16} color={colors.primary} />
          <Text style={styles.slotText} numberOfLines={1}>
            {nextSlot}
          </Text>
        </View>

        <Pressable
          onPress={onBook}
          style={({ pressed }) => [styles.bookButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Book appointment with ${name}`}
          hitSlop={4}
        >
          <Text style={styles.bookButtonText}>Book</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textInverse} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  specialty: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  slotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  slotText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  bookButton: {
    minHeight: 44,
    minWidth: 84,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: 4,
  },
  bookButtonText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
