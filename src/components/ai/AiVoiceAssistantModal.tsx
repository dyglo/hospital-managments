import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Easing,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { Text } from '@/components/ui';
import { colors, radius, shadows, spacing } from '@/theme';
import {
  ChatTurnInput,
  DeepSeekBookingPayload,
  WebSearchSource,
  requestPreVisitChat,
  stopSpeech,
  synthesizeAndPlaySpeech,
  transcribeAudioUri,
} from '@/services/ai';
import { AiDoctorCard } from './AiDoctorCard';

export type VoiceAssistantPhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'searching'
  | 'speaking';

export interface VoiceDoctorItem {
  id: string;
  name: string;
  specialty: string;
  photoURL?: string | null;
}

export interface VoiceTurnResult {
  userText: string;
  assistantText: string;
  recommendedSpecialty?: string | null;
  bookingProposal?: DeepSeekBookingPayload;
  usedWebSearch?: boolean;
  sources?: WebSearchSource[];
}

export interface AiVoiceAssistantModalProps {
  visible: boolean;
  onClose: () => void;
  history: ChatTurnInput[];
  doctors?: VoiceDoctorItem[];
  onTurnCompleted?: (turn: VoiceTurnResult) => void;
  onBookDoctor?: (doctorId: string, specialty?: string | null) => void;
}

const DEFAULT_SPEECH_THRESHOLD_DB = -44;
const BARGE_IN_THRESHOLD_DB = -26;
const BARGE_IN_CONSECUTIVE_FRAMES = 2;
const BARGE_IN_GRACE_MS = 450;
const SILENCE_HANGOVER_MS = 1150;
const MIN_RECORDING_MS = 650;
const CALIBRATION_MS = 360;
const MAX_UTTERANCE_MS = 15000;

export function AiVoiceAssistantModal({
  visible,
  onClose,
  history,
  doctors = [],
  onTurnCompleted,
  onBookDoctor,
}: AiVoiceAssistantModalProps) {
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  const [phase, setPhase] = useState<VoiceAssistantPhase>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [liveCaption, setLiveCaption] = useState(
    "I'm listening. Speak anytime — you can interrupt me whenever you have another question."
  );
  const [lastSpokenByUser, setLastSpokenByUser] = useState('');
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [sources, setSources] = useState<WebSearchSource[]>([]);
  const [recommendedSpecialty, setRecommendedSpecialty] = useState<string | null>(
    null
  );
  const [errorNote, setErrorNote] = useState<string | null>(null);

  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const voiceScaleAnim = useRef(new Animated.Value(1)).current;
  const searchPulse = useRef(new Animated.Value(0.45)).current;

  const activeRunIdRef = useRef(0);
  const callActiveRef = useRef(false);
  const isMutedRef = useRef(false);
  const phaseRef = useRef<VoiceAssistantPhase>('idle');
  const liveHistoryRef = useRef<ChatTurnInput[]>(history);
  const prefacePromiseRef = useRef<Promise<void> | null>(null);
  const bargeInCarryoverRef = useRef(false);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    liveHistoryRef.current = history;
  }, [history]);

  // Live call duration timer
  useEffect(() => {
    if (!visible) {
      setCallSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setCallSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [visible]);

  // Ambient orb animations
  useEffect(() => {
    if (!visible) return;

    const isActive =
      (phase === 'listening' && !isMuted) ||
      phase === 'speaking' ||
      phase === 'searching' ||
      phase === 'thinking' ||
      phase === 'transcribing';

    if (!isActive) {
      pulseAnim1.setValue(1);
      pulseAnim2.setValue(1);
      return;
    }

    const duration =
      phase === 'listening' ? 850 : phase === 'speaking' ? 680 : 1100;
    const maxScale1 = phase === 'listening' || phase === 'speaking' ? 1.24 : 1.14;
    const maxScale2 = phase === 'listening' || phase === 'speaking' ? 1.46 : 1.28;

    const loop1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim1, {
          toValue: maxScale1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim1, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(pulseAnim2, {
          toValue: maxScale2,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim2, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    loop1.start();
    loop2.start();

    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [visible, phase, isMuted, pulseAnim1, pulseAnim2]);

  // Searching badge pulse
  useEffect(() => {
    if (phase !== 'searching') {
      searchPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(searchPulse, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(searchPulse, {
          toValue: 0.4,
          duration: 550,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, searchPulse]);

  const ensureDuplexRecording = useCallback(async (): Promise<boolean> => {
    if (!callActiveRef.current || isMutedRef.current) return false;
    if (recorder.isRecording) return true;

    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      setErrorNote('Microphone permission is required for live voice calls.');
      return false;
    }

    if (!callActiveRef.current || isMutedRef.current) return false;

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
      interruptionMode: 'mixWithOthers',
    });

    await recorder.prepareToRecordAsync();
    recorder.record();
    return true;
  }, [recorder]);

  const startListeningLoop = useCallback(async () => {
    if (!callActiveRef.current || isMutedRef.current) {
      setPhase('idle');
      return;
    }

    setErrorNote(null);
    bargeInCarryoverRef.current = false;

    try {
      const ok = await ensureDuplexRecording();
      if (ok && callActiveRef.current && !isMutedRef.current) {
        setPhase('listening');
      } else if (callActiveRef.current) {
        setPhase('idle');
      }
    } catch (err) {
      if (!callActiveRef.current) return;
      setErrorNote(
        err instanceof Error ? err.message : 'Could not access microphone.'
      );
      setPhase('idle');
    }
  }, [ensureDuplexRecording]);

  const runAgenticTurn = useCallback(
    async (spokenText: string) => {
      const trimmed = spokenText.trim();
      if (!trimmed || !callActiveRef.current) {
        if (callActiveRef.current && !isMutedRef.current) {
          void startListeningLoop();
        } else {
          setPhase('idle');
        }
        return;
      }

      const runId = ++activeRunIdRef.current;
      setErrorNote(null);
      setLastSpokenByUser(trimmed);
      setSearchQuery(null);
      setSources([]);
      setPhase('thinking');
      prefacePromiseRef.current = null;

      try {
        const turnMessages: ChatTurnInput[] = [
          ...liveHistoryRef.current,
          { role: 'user', text: trimmed },
        ];

        const response = await requestPreVisitChat({
          messages: turnMessages,
          mode: 'general',
          onSearchStart: ({ query, spokenPreface }) => {
            if (activeRunIdRef.current !== runId || !callActiveRef.current) return;
            setPhase('searching');
            setSearchQuery(query);
            setLiveCaption(spokenPreface);
            prefacePromiseRef.current = synthesizeAndPlaySpeech(spokenPreface, {
              keepRecordingSession: true,
            }).catch(() => {});
          },
        });

        if (activeRunIdRef.current !== runId || !callActiveRef.current) return;

        if (prefacePromiseRef.current) {
          await prefacePromiseRef.current;
          prefacePromiseRef.current = null;
        }

        if (activeRunIdRef.current !== runId || !callActiveRef.current) return;

        setSearchQuery(null);
        setLiveCaption(response.text);
        setRecommendedSpecialty(response.recommendedSpecialty ?? null);
        setSources(response.sources ?? []);

        liveHistoryRef.current = [
          ...turnMessages,
          {
            role: 'assistant',
            text: response.text,
            recommendedSpecialty: response.recommendedSpecialty ?? null,
            shouldBookDoctor: Boolean(response.recommendedSpecialty),
            bookingProposal: response.bookingProposal,
          },
        ];

        onTurnCompleted?.({
          userText: trimmed,
          assistantText: response.text,
          recommendedSpecialty: response.recommendedSpecialty ?? null,
          bookingProposal: response.bookingProposal,
          usedWebSearch: response.usedWebSearch,
          sources: response.sources,
        });

        setPhase('speaking');

        // Full-duplex: keep the microphone actively recording while the AI speaks
        // so the patient can interrupt or ask another question mid-sentence.
        if (!isMutedRef.current) {
          void ensureDuplexRecording().catch(() => {});
        }

        await synthesizeAndPlaySpeech(response.text, {
          keepRecordingSession: true,
          onFinish: () => {
            if (activeRunIdRef.current === runId && callActiveRef.current) {
              if (!isMutedRef.current) {
                setPhase('listening');
              } else {
                setPhase('idle');
              }
            }
          },
        });
      } catch (err) {
        if (activeRunIdRef.current !== runId || !callActiveRef.current) return;
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Voice assistant unavailable right now.';
        setErrorNote(msg);
        if (!isMutedRef.current) {
          void startListeningLoop();
        } else {
          setPhase('idle');
        }
      }
    },
    [ensureDuplexRecording, onTurnCompleted, startListeningLoop]
  );

  const finishListeningAndSend = useCallback(async () => {
    if (phaseRef.current !== 'listening') return;
    setPhase('transcribing');

    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!callActiveRef.current) return;

      if (!uri) {
        if (!isMutedRef.current) {
          void startListeningLoop();
        } else {
          setPhase('idle');
        }
        return;
      }

      const transcript = await transcribeAudioUri(uri);
      if (!callActiveRef.current) return;

      if (!transcript.trim()) {
        if (!isMutedRef.current) {
          void startListeningLoop();
        } else {
          setPhase('idle');
        }
        return;
      }

      await runAgenticTurn(transcript);
    } catch (err) {
      if (!callActiveRef.current) return;
      setErrorNote(
        err instanceof Error
          ? err.message
          : 'Could not hear clearly. Still listening...'
      );
      if (!isMutedRef.current) {
        setTimeout(() => {
          if (callActiveRef.current && !isMutedRef.current) {
            void startListeningLoop();
          }
        }, 700);
      } else {
        setPhase('idle');
      }
    }
  }, [recorder, runAgenticTurn, startListeningLoop]);

  // Full-duplex Voice Activity Detection + Barge-In while listening OR speaking
  useEffect(() => {
    if (!visible || isMuted) return;
    if (phase !== 'listening' && phase !== 'speaking') return;

    let hasSpoken = phase === 'listening' && bargeInCarryoverRef.current;
    let lastSpeechAt = hasSpoken ? Date.now() : 0;
    let firstSpeechAt = hasSpoken ? Date.now() : 0;
    let bargeInFrames = 0;
    const startedAt = Date.now();
    let triggered = false;
    const ambientSamples: number[] = [];
    let adaptiveThresholdDb = DEFAULT_SPEECH_THRESHOLD_DB;

    const poller = setInterval(() => {
      if (triggered || !callActiveRef.current) return;
      const currentPhase = phaseRef.current;
      if (currentPhase !== 'listening' && currentPhase !== 'speaking') return;

      const status = recorder.getStatus();
      const metering = status?.metering;
      if (typeof metering !== 'number') return;

      // Drive live orb mic-level reaction
      const normalized = Math.max(0, Math.min(1, (metering + 55) / 45));
      Animated.timing(voiceScaleAnim, {
        toValue: 1 + normalized * 0.22,
        duration: 110,
        useNativeDriver: true,
      }).start();

      const now = Date.now();

      if (currentPhase === 'speaking') {
        if (now - startedAt < BARGE_IN_GRACE_MS) return;
        if (metering > BARGE_IN_THRESHOLD_DB) {
          bargeInFrames += 1;
          if (bargeInFrames >= BARGE_IN_CONSECUTIVE_FRAMES) {
            // Patient started speaking over the AI — immediate full-duplex barge-in!
            triggered = true;
            activeRunIdRef.current += 1;
            stopSpeech();
            bargeInCarryoverRef.current = true;
            setPhase('listening');
          }
        } else {
          bargeInFrames = 0;
        }
        return;
      }

      // Calibrate ambient noise floor during the first ~360ms if not already speaking
      if (!hasSpoken && now - startedAt < CALIBRATION_MS) {
        if (metering > -150) {
          ambientSamples.push(metering);
          const avgAmbient =
            ambientSamples.reduce((a, b) => a + b, 0) / ambientSamples.length;
          adaptiveThresholdDb = Math.max(-48, Math.min(-24, avgAmbient + 9));
        }
        return;
      }

      // currentPhase === 'listening'
      if (metering > adaptiveThresholdDb) {
        if (!hasSpoken) {
          hasSpoken = true;
          firstSpeechAt = now;
        }
        lastSpeechAt = now;
      }

      const silenceElapsed = hasSpoken ? now - lastSpeechAt : 0;
      const speechElapsed = hasSpoken ? now - firstSpeechAt : 0;

      if (
        hasSpoken &&
        now - startedAt >= MIN_RECORDING_MS &&
        (silenceElapsed >= SILENCE_HANGOVER_MS || speechElapsed >= MAX_UTTERANCE_MS)
      ) {
        triggered = true;
        bargeInCarryoverRef.current = false;
        void finishListeningAndSend();
      }
    }, 120);

    return () => {
      clearInterval(poller);
      voiceScaleAnim.setValue(1);
    };
  }, [
    visible,
    phase,
    isMuted,
    recorder,
    voiceScaleAnim,
    finishListeningAndSend,
  ]);

  // Auto-start live call when modal opens; clean up on close
  useEffect(() => {
    if (visible) {
      callActiveRef.current = true;
      setIsMuted(false);
      isMutedRef.current = false;
      setErrorNote(null);
      setSearchQuery(null);
      bargeInCarryoverRef.current = false;
      void startListeningLoop();
    } else {
      callActiveRef.current = false;
      activeRunIdRef.current += 1;
      try {
        stopSpeech();
      } catch {
        // Ignore cleanup errors
      }
      try {
        if (recorder.isRecording) {
          void recorder.stop().catch(() => {});
        }
      } catch {
        // Ignore recorder cleanup errors
      }
      setPhase('idle');
      setSearchQuery(null);
      setErrorNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const handleEndCall = () => {
    callActiveRef.current = false;
    activeRunIdRef.current += 1;
    setPhase('idle');
    onClose();
    try {
      stopSpeech();
    } catch {
      // Ignore cleanup errors
    }
    try {
      if (recorder.isRecording) {
        void recorder.stop().catch(() => {});
      }
    } catch {
      // Ignore recorder cleanup errors
    }
    void setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    }).catch(() => {});
  };

  const handleToggleMute = async () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    isMutedRef.current = nextMuted;

    if (nextMuted) {
      if (recorder.isRecording) {
        await recorder.stop().catch(() => {});
      }
      if (phase === 'listening') {
        setPhase('idle');
      }
    } else if (phase === 'idle' || phase === 'speaking') {
      if (phase === 'idle') {
        void startListeningLoop();
      } else {
        void ensureDuplexRecording().catch(() => {});
      }
    }
  };

  const handleInterruptOrSendNow = () => {
    if (phase === 'speaking') {
      activeRunIdRef.current += 1;
      stopSpeech();
      bargeInCarryoverRef.current = false;
      if (!isMuted) {
        if (recorder.isRecording) {
          setPhase('listening');
        } else {
          void startListeningLoop();
        }
      } else {
        setPhase('idle');
      }
    } else if (phase === 'listening') {
      void finishListeningAndSend();
    } else if (phase === 'idle' && !isMuted) {
      void startListeningLoop();
    }
  };

  const matchedDoctors = useMemo(() => {
    if (!recommendedSpecialty) return [];
    const target = recommendedSpecialty.toLowerCase();
    const filtered = doctors.filter((d) =>
      d.specialty.toLowerCase().includes(target)
    );
    return (filtered.length > 0 ? filtered : doctors).slice(0, 2);
  }, [doctors, recommendedSpecialty]);

  const formatCallTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const statusLabel = (() => {
    if (isMuted && phase === 'idle') return 'Microphone muted';
    switch (phase) {
      case 'listening':
        return 'Live Call — Listening...';
      case 'transcribing':
        return 'Understanding...';
      case 'thinking':
        return 'Thinking...';
      case 'searching':
        return 'Searching the web...';
      case 'speaking':
        return 'Speaking — interrupt anytime';
      default:
        return 'Connected';
    }
  })();

  const orbColor = isMuted
    ? colors.textTertiary
    : phase === 'listening'
    ? colors.primary
    : phase === 'searching'
    ? colors.info
    : phase === 'speaking'
    ? colors.success
    : colors.primary;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleEndCall}
    >
      <View
        style={[
          styles.container,
          {
            paddingTop: Math.max(spacing.lg, insets.top),
          },
        ]}
      >
        {/* Live Call Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.liveRow}>
              <View style={styles.liveDot} />
              <Text style={styles.headerTitle}>Care Assistant</Text>
            </View>
            <Text style={styles.headerSubtitle}>
              Live Call • {formatCallTime(callSeconds)}
            </Text>
          </View>
          <View style={styles.guidanceBadge}>
            <Text style={styles.guidanceBadgeText}>Guidance only</Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Reactive Full-Duplex Voice Orb */}
          <View style={styles.orbSection}>
            <View style={styles.orbCenterWrap}>
              <Animated.View
                style={[
                  styles.orbRingOuter,
                  {
                    backgroundColor: orbColor,
                    transform: [{ scale: pulseAnim2 }],
                  },
                ]}
              />
              <Animated.View
                style={[
                  styles.orbRingInner,
                  {
                    backgroundColor: orbColor,
                    transform: [{ scale: pulseAnim1 }],
                  },
                ]}
              />
              <Animated.View style={{ transform: [{ scale: voiceScaleAnim }] }}>
                <Pressable
                  onPress={handleInterruptOrSendNow}
                  disabled={
                    phase === 'transcribing' ||
                    phase === 'thinking' ||
                    phase === 'searching'
                  }
                  style={({ pressed }) => [
                    styles.orbButton,
                    { backgroundColor: orbColor },
                    shadows.md,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={statusLabel}
                >
                  <Ionicons
                    name={
                      isMuted
                        ? 'mic-off'
                        : phase === 'speaking'
                        ? 'volume-high'
                        : phase === 'searching'
                        ? 'globe-outline'
                        : 'mic'
                    }
                    size={38}
                    color={colors.textInverse}
                  />
                </Pressable>
              </Animated.View>
            </View>

            <Text style={styles.statusText}>{statusLabel}</Text>

            {phase === 'searching' && (
              <Animated.View
                style={[styles.searchBanner, { opacity: searchPulse }]}
              >
                <Ionicons name="globe-outline" size={16} color={colors.info} />
                <View style={styles.searchBannerTextCol}>
                  <Text style={styles.searchBannerTitle}>
                    Searching the web...
                  </Text>
                  {searchQuery ? (
                    <Text style={styles.searchBannerQuery} numberOfLines={1}>
                      {searchQuery}
                    </Text>
                  ) : null}
                </View>
              </Animated.View>
            )}
          </View>

          {/* Live Call Captions (not a chat feed) */}
          <View style={styles.captionBox}>
            {Boolean(lastSpokenByUser) && (
              <Text style={styles.userCaptionText} numberOfLines={2}>
                You: "{lastSpokenByUser}"
              </Text>
            )}
            <Text style={styles.assistantCaptionText}>{liveCaption}</Text>

            {sources.length > 0 && (
              <View style={styles.sourcesChips}>
                {sources.map((src, idx) => (
                  <Pressable
                    key={`${src.url}_${idx}`}
                    onPress={() => void Linking.openURL(src.url).catch(() => {})}
                    style={({ pressed }) => [
                      styles.sourceChip,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={12}
                      color={colors.info}
                    />
                    <Text style={styles.sourceChipText} numberOfLines={1}>
                      {src.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Doctor Booking Cards when recommended */}
          {recommendedSpecialty && matchedDoctors.length > 0 && (
            <View style={styles.doctorSection}>
              <Text style={styles.doctorSectionTitle}>
                Suggested {recommendedSpecialty} Doctors
              </Text>
              {matchedDoctors.map((doc) => (
                <AiDoctorCard
                  key={doc.id}
                  id={doc.id}
                  name={doc.name}
                  specialty={doc.specialty}
                  nextSlot="Next open slot available"
                  photoURL={doc.photoURL}
                  onBook={() => {
                    handleEndCall();
                    onBookDoctor?.(doc.id, recommendedSpecialty);
                  }}
                />
              ))}
            </View>
          )}

          {errorNote && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color="#B45309" />
              <Text style={styles.errorText}>{errorNote}</Text>
            </View>
          )}
        </ScrollView>

        {/* Bottom Phone-Call Control Bar */}
        <View
          style={[
            styles.callControls,
            { paddingBottom: Math.max(spacing.lg, insets.bottom) },
          ]}
        >
          <Pressable
            onPress={() => void handleToggleMute()}
            style={({ pressed }) => [
              styles.controlBtn,
              isMuted ? styles.controlBtnActive : styles.controlBtnNeutral,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            <Ionicons
              name={isMuted ? 'mic-off' : 'mic'}
              size={20}
              color={isMuted ? colors.textInverse : colors.textPrimary}
            />
            <Text
              style={[
                styles.controlLabel,
                isMuted && styles.controlLabelInverse,
              ]}
            >
              {isMuted ? 'Unmute' : 'Mute'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleInterruptOrSendNow}
            disabled={
              phase === 'transcribing' ||
              phase === 'thinking' ||
              phase === 'searching'
            }
            style={({ pressed }) => [
              styles.controlBtn,
              styles.interruptBtn,
              (phase === 'transcribing' ||
                phase === 'thinking' ||
                phase === 'searching') &&
                styles.controlBtnDisabled,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              phase === 'speaking' ? 'Interrupt and speak' : 'Send speech now'
            }
          >
            <Ionicons
              name={phase === 'speaking' ? 'hand-left-outline' : 'send'}
              size={18}
              color={colors.primary}
            />
            <Text style={styles.interruptLabel}>
              {phase === 'speaking' ? 'Interrupt' : 'Speak'}
            </Text>
          </Pressable>

          <Pressable
            onPress={handleEndCall}
            style={({ pressed }) => [
              styles.controlBtn,
              styles.endCallBtn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="End call"
          >
            <Ionicons name="call" size={20} color={colors.textInverse} />
            <Text style={[styles.controlLabel, styles.controlLabelInverse]}>
              End
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    gap: 2,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  guidanceBadge: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  guidanceBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.xl,
    gap: spacing.xl,
    paddingBottom: spacing['2xl'],
  },
  orbSection: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  orbCenterWrap: {
    width: 164,
    height: 164,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbRingOuter: {
    position: 'absolute',
    width: 138,
    height: 138,
    borderRadius: 69,
    opacity: 0.14,
  },
  orbRingInner: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: 58,
    opacity: 0.24,
  },
  orbButton: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  searchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.infoSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#D9DCFE',
    maxWidth: '92%',
  },
  searchBannerTextCol: {
    flexShrink: 1,
  },
  searchBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.info,
  },
  searchBannerQuery: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  captionBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  userCaptionText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textTertiary,
    fontStyle: 'italic',
  },
  assistantCaptionText: {
    fontSize: 17,
    lineHeight: 26,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  sourcesChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  sourceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.infoSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    maxWidth: '100%',
  },
  sourceChipText: {
    fontSize: 11,
    color: colors.info,
    fontWeight: '600',
    flexShrink: 1,
  },
  doctorSection: {
    gap: spacing.sm,
  },
  doctorSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  errorText: {
    fontSize: 13,
    color: '#92400E',
    flex: 1,
  },
  callControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  controlBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  controlBtnNeutral: {
    backgroundColor: colors.surfaceAlt,
  },
  controlBtnActive: {
    backgroundColor: colors.textPrimary,
  },
  interruptBtn: {
    backgroundColor: colors.primarySoft,
  },
  controlBtnDisabled: {
    opacity: 0.45,
  },
  endCallBtn: {
    backgroundColor: colors.danger,
  },
  controlLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  controlLabelInverse: {
    color: colors.textInverse,
  },
  interruptLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  pressed: {
    opacity: 0.78,
  },
});
