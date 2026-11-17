import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  LayoutAnimation,
  LayoutChangeEvent,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface UseKeyboardAvoidanceOptions {
  /** Called when the soft keyboard opens (e.g. to scroll a list to the end). */
  onKeyboardShow?: () => void;
  /** Additional vertical offset (e.g. if a native navigation header sits above SafeAreaView). */
  extraVerticalOffset?: number;
}

export interface UseKeyboardAvoidanceResult {
  /** Whether the soft keyboard is currently visible. */
  keyboardVisible: boolean;
  /**
   * Extra bottom padding needed on Android when edge-to-edge or pan mode
   * prevents the window from resizing by the full keyboard height.
   * Always 0 on iOS (handled natively by KeyboardAvoidingView).
   */
  androidPaddingBottom: number;
  /** Attach to the KeyboardAvoidingView's onLayout prop. */
  onContainerLayout: (event: LayoutChangeEvent) => void;
  /** Platform-appropriate behavior prop for KeyboardAvoidingView. */
  keyboardAvoidingBehavior: 'padding' | undefined;
  /**
   * Vertical offset for KeyboardAvoidingView on iOS.
   * Accounts for SafeAreaView's top inset so KeyboardAvoidingView's
   * parent-relative frame.y aligns with window screenY.
   */
  keyboardVerticalOffset: number;
}

/**
 * Coordinates KeyboardAvoidingView across iOS and Android (including Android
 * edge-to-edge where adjustResize may not shrink the root view).
 */
export function useKeyboardAvoidance(
  options?: UseKeyboardAvoidanceOptions
): UseKeyboardAvoidanceResult {
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [androidPaddingBottom, setAndroidPaddingBottom] = useState(0);

  const keyboardVisibleRef = useRef(false);
  const baseHeightRef = useRef(0);
  const currentHeightRef = useRef(0);
  const lastKeyboardHeightRef = useRef(0);
  const onKeyboardShowRef = useRef(options?.onKeyboardShow);
  onKeyboardShowRef.current = options?.onKeyboardShow;

  const updateAndroidPadding = useCallback((kbHeight: number) => {
    const shrunkBy = Math.max(0, baseHeightRef.current - currentHeightRef.current);
    const neededPadding = Math.max(0, kbHeight - shrunkBy);
    setAndroidPaddingBottom((prev) => {
      if (prev !== neededPadding) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      return neededPadding;
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      keyboardVisibleRef.current = true;
      setKeyboardVisible(true);

      if (Platform.OS === 'android') {
        const kbHeight = e.endCoordinates?.height ?? 0;
        lastKeyboardHeightRef.current = kbHeight;
        // Wait one frame to see if the OS already resized the container.
        requestAnimationFrame(() => {
          if (keyboardVisibleRef.current) {
            updateAndroidPadding(kbHeight);
          }
        });
      }

      onKeyboardShowRef.current?.();
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
      lastKeyboardHeightRef.current = 0;
      setKeyboardVisible(false);

      if (Platform.OS === 'android') {
        setAndroidPaddingBottom((prev) => {
          if (prev > 0) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          }
          return 0;
        });
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [updateAndroidPadding]);

  const onContainerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      currentHeightRef.current = height;
      if (!keyboardVisibleRef.current && height > 0) {
        baseHeightRef.current = height;
      } else if (
        Platform.OS === 'android' &&
        keyboardVisibleRef.current &&
        lastKeyboardHeightRef.current > 0
      ) {
        updateAndroidPadding(lastKeyboardHeightRef.current);
      }
    },
    [updateAndroidPadding]
  );

  return {
    keyboardVisible,
    androidPaddingBottom,
    onContainerLayout,
    keyboardAvoidingBehavior: Platform.OS === 'ios' ? 'padding' : undefined,
    keyboardVerticalOffset:
      Platform.OS === 'ios' ? insets.top + (options?.extraVerticalOffset ?? 0) : 0,
  };
}
