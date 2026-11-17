import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  ViewStyle,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen, Text, Button } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import { useKeyboardAvoidance } from '@/hooks';

export interface PreVisitQuestion {
  id: string;
  prompt: string;
  options?: string[];
}

export type PreVisitChatState = 'in_progress' | 'loading' | 'completed' | 'empty' | 'error' | 'offline';

export interface AiPreVisitChatProps {
  questions?: PreVisitQuestion[];
  onComplete: (answers: Record<string, string>) => void;
  onSkip?: () => void;
  doctorName?: string;
  state?: PreVisitChatState;
  style?: ViewStyle;
}

const DEFAULT_QUESTIONS: PreVisitQuestion[] = [
  {
    id: 'duration',
    prompt: 'How long have you been experiencing these symptoms?',
    options: ['Just today', '2 to 3 days', 'About a week', 'More than a month'],
  },
  {
    id: 'severity',
    prompt: 'How intense is the discomfort when it occurs?',
    options: ['Mild — manageable', 'Moderate — interrupts tasks', 'Severe — hard to rest', "I don't know"],
  },
  {
    id: 'medications',
    prompt: 'Are you currently taking any prescription medications or over-the-counter remedies?',
    options: ['None', 'Yes, daily prescriptions', 'Only pain relievers as needed', 'Prefer to discuss with doctor'],
  },
  {
    id: 'allergies',
    prompt: 'Do you have any known allergies to medicines or latex?',
    options: ['No known allergies', 'Penicillin', 'Sulfa drugs', 'Other (I will specify)'],
  },
  {
    id: 'concerns',
    prompt: 'Is there any particular concern or question you want to be sure your doctor addresses?',
    options: ['No other concerns', 'Medication side effects', 'When I can return to work/activity'],
  },
];

export function AiPreVisitChat({
  questions = DEFAULT_QUESTIONS,
  onComplete,
  onSkip,
  doctorName = 'your doctor',
  state = 'in_progress',
  style,
}: AiPreVisitChatProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customText, setCustomText] = useState('');
  const [loadingNext, setLoadingNext] = useState(false);
  const [isDone, setIsDone] = useState(state === 'completed');
  const insets = useSafeAreaInsets();
  const {
    keyboardVisible,
    androidPaddingBottom,
    onContainerLayout,
    keyboardAvoidingBehavior,
    keyboardVerticalOffset,
  } = useKeyboardAvoidance();

  const totalQuestions = questions.length;
  const currentQuestion = questions[currentIndex];

  const handleSelectAnswer = (ans: string) => {
    const updated = { ...answers, [currentQuestion.id]: ans };
    setAnswers(updated);
    setCustomText('');

    if (currentIndex + 1 < totalQuestions) {
      setLoadingNext(true);
      setTimeout(() => {
        setCurrentIndex(currentIndex + 1);
        setLoadingNext(false);
      }, 250);
    } else {
      setIsDone(true);
      onComplete(updated);
    }
  };

  const handleSendCustom = () => {
    if (customText.trim()) {
      handleSelectAnswer(customText.trim());
    }
  };

  // Completion State
  if (isDone || state === 'completed') {
    return (
      <Screen padded={false} background={colors.background}>
        <View style={[styles.completedContent, style]}>
          <View style={styles.successIconCircle}>
            <Ionicons name="checkmark" size={36} color={colors.success} />
          </View>
          <Text style={styles.completedTitle}>All Set!</Text>
          <Text style={styles.completedMessage}>
            Thank you. I've shared this with {doctorName}.
          </Text>
          <Button
            title="Done"
            onPress={() => onComplete(answers)}
            style={styles.doneButton}
          />
        </View>
      </Screen>
    );
  }

  // Empty State (no questions needed)
  if (state === 'empty' || totalQuestions === 0) {
    return (
      <Screen padded={false} background={colors.background}>
        <View style={[styles.completedContent, style]}>
          <View style={styles.neutralIconCircle}>
            <Ionicons name="document-text-outline" size={36} color={colors.primary} />
          </View>
          <Text style={styles.completedTitle}>No Extra Questions</Text>
          <Text style={styles.completedMessage}>
            You're all set! No extra questions are needed before your visit with {doctorName}.
          </Text>
          <Button
            title="Done"
            onPress={() => onComplete({})}
            style={styles.doneButton}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} background={colors.background}>
      <KeyboardAvoidingView
        style={[
          styles.flex,
          androidPaddingBottom > 0 ? { paddingBottom: androidPaddingBottom } : null,
        ]}
        behavior={keyboardAvoidingBehavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
        onLayout={onContainerLayout}
      >
      {/* Top Bar with Progress */}
      <View style={styles.topBar}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressText}>
            Question {currentIndex + 1} of {totalQuestions}
          </Text>
          {onSkip && (
            <Pressable
              onPress={onSkip}
              style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Skip remaining questions"
            >
              <Text style={styles.skipButtonText}>Skip for now</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.progressBarBackground}>
          <View
            style={[
              styles.progressBarFill,
              { width: `${((currentIndex + 1) / totalQuestions) * 100}%` },
            ]}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* Assistant Bubble */}
        <View style={styles.assistantBubble}>
          <View style={styles.bubbleHeader}>
            <View style={styles.assistantTag}>
              <Ionicons name="sparkles" size={13} color={colors.primary} />
              <Text style={styles.assistantTagText}>Pre-Visit Assistant</Text>
            </View>
          </View>

          {loadingNext ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.loadingPromptText}>Preparing next question...</Text>
            </View>
          ) : (
            <Text style={styles.questionPrompt}>{currentQuestion.prompt}</Text>
          )}

          <View style={styles.disclaimerRow}>
            <Ionicons name="information-circle-outline" size={13} color={colors.textSecondary} />
            <Text style={styles.disclaimerText}>Guidance only, not a diagnosis.</Text>
          </View>
        </View>

        {/* Quick Reply Chips (min 44px height) */}
        {!loadingNext && currentQuestion.options && (
          <View style={styles.optionsContainer}>
            <Text style={styles.optionsLabel}>Choose an answer or type below:</Text>
            <View style={styles.chipsGrid}>
              {currentQuestion.options.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => handleSelectAnswer(option)}
                  style={({ pressed }) => [styles.quickChip, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={option}
                >
                  <Text style={styles.quickChipText}>{option}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.primary} />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Custom Answer Input Bar */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: keyboardVisible
              ? spacing.md
              : Math.max(spacing.md, insets.bottom),
          },
        ]}
      >
        <TextInput
          style={styles.bottomInput}
          placeholder="Type your own answer here..."
          placeholderTextColor={colors.textTertiary}
          value={customText}
          onChangeText={setCustomText}
          editable={!loadingNext}
        />
        <Pressable
          onPress={handleSendCustom}
          disabled={!customText.trim() || loadingNext}
          style={({ pressed }) => [
            styles.bottomSendBtn,
            !customText.trim() && styles.bottomSendBtnDisabled,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send custom answer"
        >
          <Ionicons name="arrow-up" size={20} color={colors.textInverse} />
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  topBar: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  skipButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  skipButtonText: {
    fontSize: 14,
    color: colors.textSecondary,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  progressBarBackground: {
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
  },
  scrollContent: {
    padding: spacing.xl,
    gap: spacing.xl,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: spacing.md,
  },
  bubbleHeader: {
    flexDirection: 'row',
  },
  assistantTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  assistantTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  questionPrompt: {
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingPromptText: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  disclaimerText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  optionsContainer: {
    gap: spacing.md,
  },
  optionsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipsGrid: {
    gap: spacing.sm,
  },
  quickChip: {
    minHeight: 48,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  quickChipText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomInput: {
    flex: 1,
    minHeight: 44,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    fontSize: 15,
    color: colors.textPrimary,
  },
  bottomSendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomSendBtnDisabled: {
    backgroundColor: colors.borderStrong,
  },
  completedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
    gap: spacing.lg,
  },
  successIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  neutralIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  completedMessage: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  doneButton: {
    marginTop: spacing.md,
    minWidth: 160,
  },
  pressed: {
    opacity: 0.75,
  },
});
