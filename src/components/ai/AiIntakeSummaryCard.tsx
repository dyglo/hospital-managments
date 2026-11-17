import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text, Card } from '@/components/ui';
import { colors, radius, spacing, shadows } from '@/theme';

export interface IntakeData {
  complaint?: string;
  duration?: string;
  severity?: string;
  medications?: string;
  allergies?: string;
  otherConditions?: string;
  concerns?: string;
  photos?: string;
  isUrgentConcern?: boolean;
}

export type IntakeSummaryState = 'success' | 'loading' | 'empty' | 'error' | 'offline';

export interface AiIntakeSummaryCardProps {
  intake?: IntakeData | null;
  state?: IntakeSummaryState;
  onViewFullChat?: () => void;
  onMarkReviewed?: (reviewed: boolean) => void;
  onSendReminder?: () => void;
  isInitiallyReviewed?: boolean;
  style?: ViewStyle;
}

export function AiIntakeSummaryCard({
  intake,
  state = 'success',
  onViewFullChat,
  onMarkReviewed,
  onSendReminder,
  isInitiallyReviewed = false,
  style,
}: AiIntakeSummaryCardProps) {
  const [reviewed, setReviewed] = useState(isInitiallyReviewed);

  const handleToggleReviewed = () => {
    const next = !reviewed;
    setReviewed(next);
    onMarkReviewed?.(next);
  };

  // Loading State
  if (state === 'loading') {
    return (
      <Card style={[styles.card, styles.loadingCard, style]}>
        <View style={styles.badgeRow}>
          <View style={styles.aiBadge}>
            <Ionicons name="sparkles" size={13} color={colors.info} />
            <Text style={styles.aiBadgeText}>AI-generated</Text>
          </View>
        </View>
        <View style={styles.loadingBody}>
          <ActivityIndicator size="small" color={colors.info} />
          <Text style={styles.loadingText}>Organizing patient intake responses...</Text>
        </View>
      </Card>
    );
  }

  // Empty State (Patient hasn't filled questions yet)
  if (state === 'empty' || !intake) {
    return (
      <Card style={[styles.card, style]}>
        <View style={styles.badgeRow}>
          <View style={styles.aiBadge}>
            <Ionicons name="sparkles" size={13} color={colors.info} />
            <Text style={styles.aiBadgeText}>AI-generated</Text>
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyTitle}>Intake not submitted</Text>
          <Text style={styles.emptyMessage}>
            The patient has not completed their pre-visit questionnaire yet.
          </Text>
          {onSendReminder && (
            <Pressable
              onPress={onSendReminder}
              style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Send intake reminder"
            >
              <Ionicons name="notifications-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.outlineButtonText}>Send intake reminder</Text>
            </Pressable>
          )}
        </View>
      </Card>
    );
  }

  // Error State
  if (state === 'error') {
    return (
      <Card style={[styles.card, styles.errorCard, style]}>
        <View style={styles.errorHeader}>
          <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
          <Text style={styles.errorTitle}>Intake summary unavailable</Text>
        </View>
        <Text style={styles.errorBody}>
          Unable to generate structured summary at this moment. You can review the raw pre-visit chat directly.
        </Text>
        {onViewFullChat && (
          <Pressable
            onPress={onViewFullChat}
            style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Ionicons name="chatbubbles-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.outlineButtonText}>View full intake chat</Text>
          </Pressable>
        )}
      </Card>
    );
  }

  // Offline State Notice
  const isOffline = state === 'offline';

  const rows = [
    { label: 'Complaint', value: intake.complaint },
    { label: 'Duration', value: intake.duration },
    { label: 'Severity', value: intake.severity },
    { label: 'Medications', value: intake.medications },
    { label: 'Allergies', value: intake.allergies },
    { label: 'Other conditions', value: intake.otherConditions },
    { label: 'Concerns', value: intake.concerns, isConcern: true },
    { label: 'Photos', value: intake.photos, isPhoto: true },
  ];

  return (
    <Card style={[styles.card, shadows.sm, style]}>
      {/* Header with AI-generated label */}
      <View style={styles.badgeRow}>
        <View style={styles.aiBadge}>
          <Ionicons name="sparkles" size={13} color={colors.info} />
          <Text style={styles.aiBadgeText}>AI-generated</Text>
        </View>

        {isOffline && (
          <View style={styles.offlinePill}>
            <Ionicons name="cloud-offline-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.offlinePillText}>Cached</Text>
          </View>
        )}

        {reviewed && (
          <View style={styles.reviewedBadge}>
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            <Text style={styles.reviewedBadgeText}>Reviewed</Text>
          </View>
        )}
      </View>

      <Text style={styles.cardHeading}>Pre-Visit Intake Summary</Text>

      {/* Structured Rows */}
      <View style={styles.rowsContainer}>
        {rows.map((row) => {
          const isPhotoRow = 'isPhoto' in row && row.isPhoto;
          const emptyValue = isPhotoRow ? 'None' : 'Not stated';
          const isNotStated =
            !row.value ||
            row.value.trim().toLowerCase() === 'not stated' ||
            (isPhotoRow && row.value.trim().toLowerCase() === 'none');
          const isHighlighted = row.isConcern && intake.isUrgentConcern && !isNotStated;

          return (
            <View
              key={row.label}
              style={[
                styles.row,
                isHighlighted && styles.highlightedRow,
              ]}
            >
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text
                style={[
                  styles.rowValue,
                  isNotStated && styles.rowValueMuted,
                  isHighlighted && styles.rowValueUrgent,
                ]}
              >
                {isNotStated ? emptyValue : row.value}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Action Buttons (min 44px touch target) */}
      <View style={styles.actionRow}>
        {onViewFullChat && (
          <Pressable
            onPress={onViewFullChat}
            style={({ pressed }) => [styles.actionButtonOutline, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="View full intake chat"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.actionButtonOutlineText}>View full intake chat</Text>
          </Pressable>
        )}

        <Pressable
          onPress={handleToggleReviewed}
          style={({ pressed }) => [
            styles.actionButtonPrimary,
            reviewed && styles.actionButtonReviewed,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={reviewed ? 'Mark as unreviewed' : 'Mark as reviewed'}
        >
          <Ionicons
            name={reviewed ? 'checkmark-circle' : 'checkmark'}
            size={18}
            color={colors.textInverse}
          />
          <Text style={styles.actionButtonPrimaryText}>
            {reviewed ? 'Reviewed' : 'Mark as reviewed'}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  loadingCard: {
    paddingVertical: spacing['2xl'],
  },
  loadingBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.infoSoft,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  aiBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.info,
  },
  offlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  offlinePillText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  reviewedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  reviewedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  cardHeading: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowsContainer: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  highlightedRow: {
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderBottomColor: 'transparent',
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    width: 110,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  rowValueMuted: {
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  rowValueUrgent: {
    color: '#B45309',
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  actionButtonOutline: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  actionButtonOutlineText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionButtonPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  actionButtonReviewed: {
    backgroundColor: colors.success,
  },
  actionButtonPrimaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textInverse,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  emptyMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  errorCard: {
    backgroundColor: colors.warningSoft,
    borderColor: '#FDE68A',
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
  errorBody: {
    fontSize: 14,
    color: '#92400E',
    lineHeight: 20,
  },
  outlineButton: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    gap: 6,
    marginTop: spacing.xs,
  },
  outlineButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.75,
  },
});
