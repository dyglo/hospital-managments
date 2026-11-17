import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Image,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActionSheetIOS,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Text, IconButton } from '@/components/ui';
import { AiDoctorCard } from '@/components/ai';
import { colors, radius, spacing, shadows } from '@/theme';
import { useDoctors, useKeyboardAvoidance } from '@/hooks';
import { PatientStackParamList } from '@/navigation/types';
import {
  DeepSeekBookingPayload,
  MAX_ATTACHMENTS,
  StagedPhoto,
  pickAndPreparePhoto,
  requestPreVisitChat,
} from '@/services/ai';

type Props = NativeStackScreenProps<PatientStackParamList, 'AiAssistant'>;

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  photoUris?: string[];
  recommendedSpecialty?: string | null;
  bookingProposal?: DeepSeekBookingPayload;
  isNotice?: boolean;
}

const STARTER_CHIPS = [
  'Check my symptoms',
  'Help me pick a doctor',
  'Read my lab report photo',
];

function TypingDots() {
  const dots = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]).current;

  useEffect(() => {
    const animations = dots.map((dot, idx) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(idx * 140),
          Animated.timing(dot, {
            toValue: 1,
            duration: 320,
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.35,
            duration: 320,
            useNativeDriver: true,
          }),
          Animated.delay((2 - idx) * 140),
        ])
      )
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={styles.typingRow} accessibilityLabel="Assistant is typing">
      {dots.map((opacity, i) => (
        <Animated.View key={i} style={[styles.typingDot, { opacity }]} />
      ))}
    </View>
  );
}

export function AiAssistantScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { doctors } = useDoctors();
  const listRef = useRef<FlatList<ChatEntry>>(null);

  const [messages, setMessages] = useState<ChatEntry[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: "Hello! I'm your Care Assistant. Tell me how you're feeling or attach up to 3 photos, and I can help guide you to the right care.",
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [stagedPhotos, setStagedPhotos] = useState<StagedPhoto[]>([]);
  const [sending, setSending] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [apiStatusNote, setApiStatusNote] = useState('');
  const {
    keyboardVisible,
    androidPaddingBottom,
    onContainerLayout,
    keyboardAvoidingBehavior,
    keyboardVerticalOffset,
  } = useKeyboardAvoidance({
    onKeyboardShow: () => {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    },
  });

  const handlePickFrom = async (source: 'camera' | 'gallery') => {
    setPhotoNotice(null);
    setPickingPhoto(true);
    try {
      const res = await pickAndPreparePhoto(source);
      if (res.friendlyError) {
        setPhotoNotice(res.friendlyError);
        return;
      }
      if (res.photo) {
        setStagedPhotos((prev) => [...prev, res.photo!].slice(0, MAX_ATTACHMENTS));
      }
    } finally {
      setPickingPhoto(false);
    }
  };

  const handleAttachPhoto = () => {
    if (sending || pickingPhoto) return;
    if (stagedPhotos.length >= MAX_ATTACHMENTS) {
      setPhotoNotice(`You can attach up to ${MAX_ATTACHMENTS} photos.`);
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take a photo', 'Choose from gallery'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) void handlePickFrom('camera');
          if (idx === 2) void handlePickFrom('gallery');
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

  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputText).trim();
    if ((!textToSend && stagedPhotos.length === 0) || sending) return;

    setPhotoNotice(null);
    setApiStatusNote('');
    const photosToUpload = [...stagedPhotos];
    setInputText('');
    setStagedPhotos([]);
    setSending(true);

    const userEntry: ChatEntry = {
      id: `u_${Date.now()}`,
      role: 'user',
      text: textToSend || 'Attached photo(s)',
      photoUris: photosToUpload.map((p) => p.localUri),
    };

    const assistantId = `a_${Date.now()}`;
    const placeholderAssistant: ChatEntry = {
      id: assistantId,
      role: 'assistant',
      text: '',
    };

    const nextHistory = [...messages, userEntry];
    setMessages([...nextHistory, placeholderAssistant]);

    try {
      const apiMessages = nextHistory
        .filter((m) => m.id !== 'welcome' && !m.isNotice && m.text.trim().length > 0)
        .map((m) => ({
          role: m.role,
          text: m.text,
          recommendedSpecialty: m.recommendedSpecialty,
          shouldBookDoctor: Boolean(m.recommendedSpecialty),
          bookingProposal: m.bookingProposal,
          isNotice: m.isNotice,
        }));

      const reply = await requestPreVisitChat({
        messages: apiMessages,
        localImageUris: photosToUpload.map((p) => p.dataUrl ?? p.localUri),
        mode: 'general',
        onDelta: (partial) => {
          setMessages((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, text: partial } : item
            )
          );
        },
      });

      setApiStatusNote(reply.statusNote || '');

      const prefix = reply.imageFailed
        ? "I couldn't view your photo, but let's continue. "
        : '';
      const finalText = `${prefix}${reply.text}`.trim();

      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                text: finalText,
                recommendedSpecialty: reply.recommendedSpecialty ?? null,
                bookingProposal: reply.bookingProposal,
                isNotice: false,
              }
            : item
        )
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'DeepSeek API unavailable';
      setApiStatusNote(message);
      setMessages((prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                text: "We couldn't check that right now. You can try again or book a doctor directly.",
                isNotice: true,
              }
            : item
        )
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={[
          styles.flex,
          androidPaddingBottom > 0 ? { paddingBottom: androidPaddingBottom } : null,
        ]}
        behavior={keyboardAvoidingBehavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
        onLayout={onContainerLayout}
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <IconButton
            name="chevron-back"
            onPress={() => navigation.goBack()}
            accessibilityLabel="Go back"
          />
          <View style={styles.headerTitleBlock}>
            <View style={styles.titleRow}>
              <Text variant="h3">Care Assistant</Text>
              <View style={styles.aiPill}>
                <Ionicons name="sparkles" size={12} color={colors.primary} />
                <Text style={styles.aiPillText}>Assistant</Text>
              </View>
            </View>
            <Text style={styles.subtitle}>Guidance only, not a diagnosis</Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('Booking')}
            style={({ pressed }) => [styles.bookShortcut, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Book a doctor"
          >
            <Text style={styles.bookShortcutText}>Book</Text>
          </Pressable>
        </View>

        {/* Messages List */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          style={styles.flex}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View
                style={[
                  styles.bubbleWrapper,
                  isUser ? styles.userWrapper : styles.assistantWrapper,
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    isUser ? styles.userBubble : styles.assistantBubble,
                    !isUser && shadows.sm,
                  ]}
                >
                  {item.photoUris && item.photoUris.length > 0 && (
                    <View style={styles.msgPhotoRow}>
                      {item.photoUris.map((uri, i) => (
                        <Image key={i} source={{ uri }} style={styles.msgPhoto} />
                      ))}
                    </View>
                  )}

                  {item.text ? (
                    <Text
                      style={[
                        styles.bubbleText,
                        isUser ? styles.userText : styles.assistantText,
                      ]}
                    >
                      {item.text}
                    </Text>
                  ) : (
                    <TypingDots />
                  )}

                  {!isUser && (
                    <View style={styles.disclaimerRow}>
                      <Ionicons
                        name="information-circle-outline"
                        size={13}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.disclaimerText}>
                        Guidance only, not a diagnosis.
                      </Text>
                    </View>
                  )}
                </View>

                {!isUser && item.recommendedSpecialty ? (
                  <View style={styles.recommendedSection}>
                    <Text style={styles.recommendedTitle}>
                      Suggested {item.recommendedSpecialty} Doctors
                    </Text>
                    {(doctors.filter((d) =>
                      d.specialty
                        .toLowerCase()
                        .includes(item.recommendedSpecialty!.toLowerCase())
                    ).length > 0
                      ? doctors.filter((d) =>
                          d.specialty
                            .toLowerCase()
                            .includes(item.recommendedSpecialty!.toLowerCase())
                        )
                      : doctors
                    )
                      .slice(0, 2)
                      .map((doc) => (
                        <AiDoctorCard
                          key={doc.id}
                          id={doc.id}
                          name={doc.name}
                          specialty={doc.specialty}
                          nextSlot="Next open slot available"
                          photoURL={doc.photoURL}
                          onBook={() =>
                            navigation.navigate('Booking', { doctorId: doc.id })
                          }
                        />
                      ))}
                  </View>
                ) : null}
              </View>
            );
          }}
          ListFooterComponent={
            messages.length === 1 ? (
              <View style={styles.starterContainer}>
                <Text style={styles.starterLabel}>Quick topics to start:</Text>
                <View style={styles.starterChips}>
                  {STARTER_CHIPS.map((chip) => (
                    <Pressable
                      key={chip}
                      onPress={() => void handleSend(chip)}
                      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                      accessibilityRole="button"
                    >
                      <Text style={styles.chipText}>{chip}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : undefined
          }
        />

        {/* API Status Note */}
        {Boolean(apiStatusNote) && (
          <View style={styles.photoNotice}>
            <Ionicons name="cloud-offline-outline" size={16} color="#B45309" />
            <Text style={styles.photoNoticeText}>{apiStatusNote}</Text>
          </View>
        )}

        {/* Photo Notice */}
        {photoNotice && (
          <View style={styles.photoNotice}>
            <Ionicons name="information-circle-outline" size={16} color="#B45309" />
            <Text style={styles.photoNoticeText}>{photoNotice}</Text>
          </View>
        )}

        {/* Staged Photo Thumbnails */}
        {stagedPhotos.length > 0 && (
          <View style={styles.stagedRow}>
            {stagedPhotos.map((p) => (
              <View key={p.id} style={styles.stagedThumbWrap}>
                <Image source={{ uri: p.localUri }} style={styles.stagedThumb} />
                <Pressable
                  onPress={() =>
                    setStagedPhotos((prev) => prev.filter((item) => item.id !== p.id))
                  }
                  style={styles.removePhotoBtn}
                  hitSlop={10}
                  accessibilityLabel="Remove photo"
                >
                  <Ionicons name="close" size={13} color={colors.textInverse} />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Input Composer */}
        <View
          style={[
            styles.composer,
            {
              paddingBottom: keyboardVisible
                ? spacing.sm
                : Math.max(spacing.md, insets.bottom),
            },
          ]}
        >
          <Pressable
            onPress={handleAttachPhoto}
            disabled={sending || pickingPhoto || stagedPhotos.length >= MAX_ATTACHMENTS}
            style={({ pressed }) => [styles.composerIconBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
          >
            {pickingPhoto ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Ionicons
                name="camera-outline"
                size={22}
                color={
                  stagedPhotos.length >= MAX_ATTACHMENTS
                    ? colors.textTertiary
                    : colors.textPrimary
                }
              />
            )}
          </Pressable>

          <TextInput
            style={styles.composerInput}
            placeholder="Ask the Care Assistant..."
            placeholderTextColor={colors.textTertiary}
            value={inputText}
            onChangeText={setInputText}
            onFocus={() =>
              setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100)
            }
            multiline
            editable={!sending}
          />

          <Pressable
            onPress={() => void handleSend()}
            disabled={(!inputText.trim() && stagedPhotos.length === 0) || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              ((!inputText.trim() && stagedPhotos.length === 0) || sending) &&
                styles.sendBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Ionicons name="arrow-up" size={20} color={colors.textInverse} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  headerTitleBlock: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  aiPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  bookShortcut: {
    minHeight: 44,
    minWidth: 64,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  bookShortcutText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  bubbleWrapper: {
    width: '100%',
  },
  userWrapper: {
    alignItems: 'flex-end',
  },
  assistantWrapper: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    gap: spacing.sm,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  bubbleText: {
    fontSize: 16,
    lineHeight: 24,
  },
  userText: {
    color: colors.textInverse,
  },
  assistantText: {
    color: colors.textPrimary,
  },
  msgPhotoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  msgPhoto: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  disclaimerText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  starterContainer: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  starterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  starterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  photoNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  photoNoticeText: {
    fontSize: 13,
    color: '#92400E',
    flex: 1,
  },
  stagedRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  stagedThumbWrap: {
    position: 'relative',
  },
  stagedThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
  },
  removePhotoBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  composerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    fontSize: 16,
    color: colors.textPrimary,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.borderStrong,
  },
  pressed: {
    opacity: 0.75,
  },
  recommendedSection: {
    width: '100%',
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  recommendedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
