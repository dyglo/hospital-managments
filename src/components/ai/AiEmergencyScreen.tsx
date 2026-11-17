import React from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Linking,
  Alert,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Text, Button } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';

export type EmergencyState = 'active' | 'locating' | 'error' | 'offline';

export interface AiEmergencyScreenProps {
  onBackToBooking: () => void;
  onLocateHospital?: () => void;
  state?: EmergencyState;
  emergencyNumber?: string;
  style?: ViewStyle;
}

export function AiEmergencyScreen({
  onBackToBooking,
  onLocateHospital,
  state = 'active',
  emergencyNumber = '911',
  style,
}: AiEmergencyScreenProps) {
  const isLocating = state === 'locating';
  const isOffline = state === 'offline';
  const isError = state === 'error';

  const handleCallEmergency = () => {
    Linking.openURL(`tel:${emergencyNumber}`).catch(() => {
      Alert.alert(
        'Call Emergency Services',
        `Please dial ${emergencyNumber} directly from your phone app immediately.`
      );
    });
  };

  const handleFindHospital = () => {
    if (onLocateHospital) {
      onLocateHospital();
      return;
    }
    const mapUrl = 'https://www.google.com/maps/search/emergency+room+hospital+near+me';
    Linking.openURL(mapUrl).catch(() => {
      Alert.alert(
        'Hospital Locator',
        'Please proceed to your nearest local hospital emergency department.'
      );
    });
  };

  return (
    <Screen padded={false} background={colors.surface}>
      <View style={[styles.content, style]}>
        {/* Large Emergency Icon */}
        <View style={styles.iconRing}>
          <View style={styles.iconInner}>
            <Ionicons name="medical" size={48} color={colors.danger} />
          </View>
        </View>

        {/* Heading & Instructions */}
        <View style={styles.textContainer}>
          <Text style={styles.heading}>Please get emergency care now</Text>
          <Text style={styles.instruction}>
            If you have severe chest pain, shortness of breath, sudden weakness, or feel faint, please call emergency services immediately.
          </Text>
        </View>

        {/* Offline indicator if applicable */}
        {isOffline && (
          <View style={styles.offlineNotice}>
            <Ionicons name="call-outline" size={16} color={colors.textPrimary} />
            <Text style={styles.offlineNoticeText}>
              Emergency phone calls work without internet. Direct call is ready.
            </Text>
          </View>
        )}

        {/* Action Buttons (No booking options anywhere on this screen) */}
        <View style={styles.actionGroup}>
          <Pressable
            onPress={handleCallEmergency}
            style={({ pressed }) => [styles.emergencyCallBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Call emergency services at ${emergencyNumber}`}
          >
            <Ionicons name="call" size={22} color={colors.textInverse} />
            <Text style={styles.emergencyCallBtnText}>Call emergency services ({emergencyNumber})</Text>
          </Pressable>

          <Pressable
            onPress={handleFindHospital}
            disabled={isLocating}
            style={({ pressed }) => [styles.hospitalBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Find nearest hospital"
          >
            {isLocating ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Ionicons name="location-outline" size={20} color={colors.textPrimary} />
            )}
            <Text style={styles.hospitalBtnText}>
              {isLocating ? 'Locating nearest hospital...' : 'Find nearest hospital'}
            </Text>
          </Pressable>
        </View>

        {/* Safe Dismissal Link */}
        <Pressable
          onPress={onBackToBooking}
          style={({ pressed }) => [styles.dismissLink, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="This is not an emergency, return to booking"
          hitSlop={12}
        >
          <Text style={styles.dismissLinkText}>This isn't an emergency — return to booking</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.surface,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing['2xl'],
    paddingTop: spacing['4xl'],
    paddingBottom: spacing['3xl'],
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing['2xl'],
  },
  iconRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FECACA',
  },
  textContainer: {
    alignItems: 'center',
    gap: spacing.md,
  },
  heading: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.danger,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  instruction: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  offlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offlineNoticeText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  actionGroup: {
    width: '100%',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  emergencyCallBtn: {
    width: '100%',
    minHeight: 52,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  emergencyCallBtnText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '700',
  },
  hospitalBtn: {
    width: '100%',
    minHeight: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  hospitalBtnText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  dismissLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  dismissLinkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.75,
  },
});
