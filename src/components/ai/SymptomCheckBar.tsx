import React, { useState } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
  ActionSheetIOS,
  Platform,
  Alert,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import {
  MAX_ATTACHMENTS,
  StagedPhoto,
  pickAndPreparePhoto,
} from '@/services/ai';

export type SymptomCheckState = 'empty' | 'loading' | 'success' | 'error' | 'offline';

export interface SymptomCheckBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (text: string, photos: StagedPhoto[]) => void;
  onVoiceInputPress?: () => void;
  onManualSpecialtyPress: () => void;
  photos?: StagedPhoto[];
  onPhotosChange?: (photos: StagedPhoto[]) => void;
  state?: SymptomCheckState;
  errorMessage?: string;
  isListening?: boolean;
  style?: ViewStyle;
}

export function SymptomCheckBar({
  value,
  onChangeText,
  onSubmit,
  onVoiceInputPress,
  onManualSpecialtyPress,
  photos = [],
  onPhotosChange,
  state = 'empty',
  errorMessage = "We couldn't check that right now. Let's find a doctor together.",
  isListening = false,
  style,
}: SymptomCheckBarProps) {
  const [focused, setFocused] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [pickingPhoto, setPickingPhoto] = useState(false);

  const isOffline = state === 'offline';
  const isError = state === 'error';
  const isLoading = state === 'loading' || isListening;
  const canSend = (Boolean(value.trim()) || photos.length > 0) && !isLoading && !isOffline;

  const handleSend = () => {
    if (canSend) {
      setPhotoNotice(null);
      onSubmit(value.trim(), photos);
    }
  };

  const handlePickFrom = async (source: 'camera' | 'gallery') => {
    setPhotoNotice(null);
    setPickingPhoto(true);
    try {
      const result = await pickAndPreparePhoto(source);
      if (result.friendlyError) {
        setPhotoNotice(result.friendlyError);
        return;
      }
      if (result.photo && onPhotosChange) {
        onPhotosChange([...photos, result.photo].slice(0, MAX_ATTACHMENTS));
      }
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleAttachPhotoPress = () => {
    if (isOffline || isLoading || pickingPhoto) return;
    if (photos.length >= MAX_ATTACHMENTS) {
      setPhotoNotice(`You can attach up to ${MAX_ATTACHMENTS} photos.`);
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take a photo', 'Choose from gallery'],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) void handlePickFrom('camera');
          if (buttonIndex === 2) void handlePickFrom('gallery');
        }
      );
    } else {
      Alert.alert('Attach a photo', 'How would you like to add a photo?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take a photo', onPress: () => void handlePickFrom('camera') },
        { text: 'Choose from gallery', onPress: () => void handlePickFrom('gallery') },
      ]);
    }
  };

  const handleRemovePhoto = (id: string) => {
    setPhotoNotice(null);
    onPhotosChange?.(photos.filter((p) => p.id !== id));
  };

  return (
    <View style={[styles.container, style]}>
      {/* Offline Notice */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.offlineText}>
            You're offline. AI suggestions are paused, but you can choose a specialty below.
          </Text>
        </View>
      )}

      {/* Main Input Box */}
      <View
        style={[
          styles.inputCard,
          focused && styles.inputCardFocused,
          isError && styles.inputCardError,
          isOffline && styles.inputCardDisabled,
        ]}
      >
        <TextInput
          style={styles.input}
          placeholder="Tell us how you're feeling..."
          placeholderTextColor={colors.textTertiary}
          value={value}
          onChangeText={onChangeText}
          editable={!isOffline && !isLoading}
          multiline
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Tell us how you are feeling"
        />

        {/* Attached Photo Thumbnails (up to 3) */}
        {photos.length > 0 && (
          <View style={styles.thumbnailRow}>
            {photos.map((photo) => (
              <View key={photo.id} style={styles.thumbWrapper}>
                <Image source={{ uri: photo.localUri }} style={styles.thumbImage} />
                <Pressable
                  onPress={() => handleRemovePhoto(photo.id)}
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Remove attached photo"
                >
                  <Ionicons name="close" size={14} color={colors.textInverse} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.actionRow}>
          <View style={styles.leftActions}>
            {/* Voice Input Button (min 44x44px) */}
            <Pressable
              onPress={onVoiceInputPress}
              disabled={isOffline || isLoading}
              style={({ pressed }) => [
                styles.iconButton,
                isListening && styles.iconButtonActive,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={isListening ? 'Listening to voice' : 'Speak symptoms'}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name={isListening ? 'mic' : 'mic-outline'}
                  size={22}
                  color={isListening ? colors.textInverse : colors.textPrimary}
                />
              )}
            </Pressable>

            {/* Camera / Photo Attachment Button (min 44x44px) */}
            <Pressable
              onPress={handleAttachPhotoPress}
              disabled={isOffline || isLoading || pickingPhoto || photos.length >= MAX_ATTACHMENTS}
              style={({ pressed }) => [
                styles.iconButton,
                photos.length >= MAX_ATTACHMENTS && styles.iconButtonDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Attach photo (${photos.length} of ${MAX_ATTACHMENTS})`}
            >
              {pickingPhoto ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name="camera-outline"
                  size={22}
                  color={
                    photos.length >= MAX_ATTACHMENTS ? colors.textTertiary : colors.textPrimary
                  }
                />
              )}
            </Pressable>
          </View>

          {/* Send Button (min 44x44px) */}
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.sendButtonDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send symptoms to AI assistant"
          >
            <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
          </Pressable>
        </View>
      </View>

      {/* Friendly Photo Validation Message */}
      {photoNotice && (
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle-outline" size={18} color="#B45309" />
          <Text style={styles.noticeText}>{photoNotice}</Text>
        </View>
      )}

      {/* Error state message with direct manual fallback button */}
      {isError && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color="#B45309" />
          <View style={styles.errorTextContainer}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable
              onPress={onManualSpecialtyPress}
              style={({ pressed }) => [styles.errorFallbackButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Choose specialty manually"
            >
              <Text style={styles.errorFallbackText}>Choose specialty manually</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Manual Fallback Link (Always available, min 44px touch height) */}
      <Pressable
        onPress={onManualSpecialtyPress}
        style={({ pressed }) => [styles.manualLink, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Or choose a specialty yourself"
        hitSlop={8}
      >
        <Text style={styles.manualLinkText}>Or choose a specialty yourself</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  offlineText: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
    lineHeight: 20,
  },
  inputCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  inputCardFocused: {
    borderColor: colors.primary,
  },
  inputCardError: {
    borderColor: colors.warning,
  },
  inputCardDisabled: {
    backgroundColor: colors.surfaceAlt,
  },
  input: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textPrimary,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  thumbnailRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  thumbWrapper: {
    position: 'relative',
    width: 60,
    height: 60,
  },
  thumbImage: {
    width: 60,
    height: 60,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  removeBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  leftActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  iconButtonActive: {
    backgroundColor: colors.primary,
  },
  iconButtonDisabled: {
    opacity: 0.5,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.borderStrong,
  },
  pressed: {
    opacity: 0.7,
  },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noticeText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#92400E',
    flex: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  errorTextContainer: {
    flex: 1,
    gap: spacing.xs,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#92400E',
    fontWeight: '500',
  },
  errorFallbackButton: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  errorFallbackText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  manualLink: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  manualLinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
