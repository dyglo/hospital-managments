import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  ActivityIndicator,
  ViewStyle,
  ScrollView,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import { colors, radius, spacing, shadows } from '@/theme';
import { AiDoctorCard, AiDoctorCardProps } from './AiDoctorCard';

export type AiReplyState = 'loading' | 'success' | 'empty' | 'error' | 'offline';

export interface AiBubbleProps {
  state?: AiReplyState;
  replyText?: string;
  suggestedSpecialty?: string;
  doctors?: Array<Omit<AiDoctorCardProps, 'onBook'> & { id: string }>;
  onBookDoctor?: (doctorId: string) => void;
  onManualSpecialtyPress?: () => void;
  style?: ViewStyle;
}

export function AiBubble({
  state = 'success',
  replyText = "It sounds like you've been having uncomfortable headaches and sensitivity to bright light for a few days. Seeing a Neurologist or General Physician can help evaluate this safely. We've gathered available specialists who can see you soonest below.",
  suggestedSpecialty = 'Neurology',
  doctors = [],
  onBookDoctor,
  onManualSpecialtyPress,
  style,
}: AiBubbleProps) {
  // Pulsing animation for typing dots
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    if (state === 'loading') {
      const animateDot = (dot: Animated.Value, delay: number) => {
        return Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(dot, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0.3,
              duration: 400,
              useNativeDriver: true,
            }),
          ])
        );
      };

      const a1 = animateDot(dot1, 0);
      const a2 = animateDot(dot2, 200);
      const a3 = animateDot(dot3, 400);

      a1.start();
      a2.start();
      a3.start();

      return () => {
        a1.stop();
        a2.stop();
        a3.stop();
      };
    }
  }, [state, dot1, dot2, dot3]);

  // Loading state: typing animation
  if (state === 'loading') {
    return (
      <View style={[styles.bubbleCard, shadows.sm, style]}>
        <View style={styles.headerRow}>
          <View style={styles.badge}>
            <Ionicons name="sparkles" size={13} color={colors.primary} />
            <Text style={styles.badgeText}>Reviewing your notes</Text>
          </View>
        </View>

        <View style={styles.typingContainer}>
          <Animated.View style={[styles.typingDot, { opacity: dot1 }]} />
          <Animated.View style={[styles.typingDot, { opacity: dot2 }]} />
          <Animated.View style={[styles.typingDot, { opacity: dot3 }]} />
          <Text style={styles.loadingText}>Finding appropriate specialists...</Text>
        </View>
      </View>
    );
  }

  // Error state: friendly, non-technical, fallback button
  if (state === 'error') {
    return (
      <View style={[styles.bubbleCard, styles.bubbleError, style]}>
        <View style={styles.errorHeader}>
          <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
          <Text style={styles.errorTitle}>We couldn't check that right now</Text>
        </View>
        <Text style={styles.bodyText}>
          Let's find a doctor together. You can choose a specialist or general physician directly.
        </Text>
        {onManualSpecialtyPress && (
          <Pressable
            onPress={onManualSpecialtyPress}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Choose a specialty yourself"
          >
            <Text style={styles.actionButtonText}>Choose a specialty yourself</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Offline state
  if (state === 'offline') {
    return (
      <View style={[styles.bubbleCard, styles.bubbleOffline, style]}>
        <View style={styles.errorHeader}>
          <Ionicons name="cloud-offline-outline" size={20} color={colors.textSecondary} />
          <Text style={styles.offlineTitle}>You're currently offline</Text>
        </View>
        <Text style={styles.bodyText}>
          We couldn't generate personalized symptom guidance, but you can still browse doctors from your saved list.
        </Text>
        {onManualSpecialtyPress && (
          <Pressable
            onPress={onManualSpecialtyPress}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.actionButtonText}>Browse available doctors</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Empty state
  if (state === 'empty') {
    return (
      <View style={[styles.bubbleCard, style]}>
        <Text style={styles.emptyPrompt}>
          Enter how you are feeling above to receive guidance on the right medical specialty and available doctors.
        </Text>
      </View>
    );
  }

  // Success state: 2-4 sentences, doctor cards, and disclaimer
  return (
    <View style={[styles.container, style]}>
      {/* AI Reply Bubble */}
      <View style={[styles.bubbleCard, shadows.sm]}>
        <View style={styles.headerRow}>
          <View style={styles.badge}>
            <Ionicons name="sparkles" size={13} color={colors.primary} />
            <Text style={styles.badgeText}>Suggested Guidance</Text>
          </View>
          {suggestedSpecialty ? (
            <View style={styles.specialtyChip}>
              <Text style={styles.specialtyChipText}>{suggestedSpecialty}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.bodyText}>{replyText}</Text>

        {/* Mandatory Patient Disclaimer Footer */}
        <View style={styles.disclaimerRow}>
          <Ionicons name="information-circle-outline" size={14} color={colors.textSecondary} />
          <Text style={styles.disclaimerText}>Guidance only, not a diagnosis.</Text>
        </View>
      </View>

      {/* Doctor Cards Section */}
      {doctors.length > 0 && (
        <View style={styles.doctorsSection}>
          <Text style={styles.doctorsTitle}>Suggested Doctors with Open Slots</Text>
          <View style={styles.doctorList}>
            {doctors.map((doc) => (
              <AiDoctorCard
                key={doc.id}
                id={doc.id}
                name={doc.name}
                specialty={doc.specialty}
                nextSlot={doc.nextSlot}
                photoURL={doc.photoURL}
                onBook={() => onBookDoctor?.(doc.id)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  bubbleCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  bubbleError: {
    backgroundColor: colors.warningSoft,
    borderColor: '#FDE68A',
  },
  bubbleOffline: {
    backgroundColor: colors.surfaceAlt,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  specialtyChip: {
    backgroundColor: colors.infoSoft,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  specialtyChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.info,
  },
  bodyText: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
    fontWeight: '400',
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  disclaimerText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  typingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xs,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  emptyPrompt: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  errorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400E',
  },
  offlineTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  actionButton: {
    minHeight: 44,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  actionButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  doctorsSection: {
    gap: spacing.sm,
  },
  doctorsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  doctorList: {
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.75,
  },
});
