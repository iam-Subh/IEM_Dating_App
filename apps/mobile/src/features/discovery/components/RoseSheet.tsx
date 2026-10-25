import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {RoseSentCelebration, type RoseConfirmation} from './profile-detail/RoseSentCelebration';

/** Kept in step with ROSE_COMMENT_MAX on the server, which truncates anyway. */
export const ROSE_COMMENT_MAX = 140;
const SPRING = { damping: 28, stiffness: 300, overshootClamping: true };
const DISMISSED_Y = 700;

type Props = {
  visible: boolean;
  name: string;
  /** Roses left this week, or null while it is still being read. */
  balance: number | null;
  onCancel: () => void;
  onSend: (comment: string | null) => Promise<void>;
  confirmation?: RoseConfirmation | null;
  photoUri?: string;
  onConfirmationComplete?: () => void;
  onDismiss?: () => void;
  /**
   * Draw inside the window already on screen - an open profile - instead of
   * a second Modal. A Modal over a Modal opens a new Android window: it is
   * slow to appear, and its first tap can be lost while it takes focus.
   */
  inline?: boolean;
};

export type RoseSheetHandle = {
  /** Closes the sheet as "Not now" does; for the hardware back button when inline. */
  dismiss: () => void;
};

/**
 * Composing a Rose (EXPLORE_SPEC.md, section 10). A Rose is a Like that costs
 * something, so it asks for confirmation the way an ordinary Like does not,
 * and it shows what sending one leaves behind - scarcity the reader cannot see
 * is scarcity they cannot spend well.
 */
export const RoseSheet = forwardRef<RoseSheetHandle, Props>(function RoseSheet({ visible, name, balance, onCancel, onSend, confirmation, photoUri, onConfirmationComplete, onDismiss, inline = false }, ref) {
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const balanceAtSend = useRef<number | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const wasVisible = useRef(visible);
  const dismissed = useRef(onDismiss);
  dismissed.current = onDismiss;
  const slide = useSharedValue(DISMISSED_Y);
  const dragStart = useSharedValue(0);
  const closing = useSharedValue(false);

  // A fresh sheet every time: last person's note must not follow the reader.
  // Before paint, so the slide starts on the first frame.
  useLayoutEffect(() => {
    if (visible) {
      setComment("");
      setSending(false);
      setCelebrating(false);
      closing.value = false;
      slide.value = DISMISSED_Y;
      slide.value = withSpring(0, SPRING);
    }
  }, [visible, slide, closing]);

  useEffect(() => {
    const didClose = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (didClose && (inline || Platform.OS !== 'ios')) {
      const frame = requestAnimationFrame(() => dismissed.current?.());
      return () => cancelAnimationFrame(frame);
    }
  }, [visible, inline]);
  // An inline sheet can leave with the profile around it, never seeing
  // visible turn false: it still reports that it closed.
  useEffect(() => () => {
    if (inline && wasVisible.current) requestAnimationFrame(() => dismissed.current?.());
  }, [inline]);

  useEffect(() => {
    if (!visible || !confirmation) return;
    Keyboard.dismiss();
    closing.value = true;
    slide.value = withTiming(DISMISSED_Y, {duration: 240}, finished => {
      if (finished) runOnJS(setCelebrating)(true);
    });
  }, [visible, confirmation, closing, slide]);

  const finishDismiss = () => {
    Keyboard.dismiss();
    onCancel();
  };
  const dismiss = () => {
    if (closing.value || sendingRef.current || confirmation) return;
    closing.value = true;
    slide.value = withTiming(DISMISSED_Y, { duration: 240 }, (finished) => {
      if (finished) runOnJS(finishDismiss)();
    });
  };
  useImperativeHandle(ref, () => ({ dismiss }));
  const drag = Gesture.Pan()
    .enabled(!sending && !confirmation)
    .activeOffsetY([-8, 8])
    .onStart(() => { dragStart.value = slide.value; })
    .onUpdate((event) => {
      if (!closing.value) slide.value = Math.max(0, Math.min(DISMISSED_Y, dragStart.value + event.translationY));
    })
    .onEnd((event) => {
      if (closing.value) return;
      const movingDown = event.velocityY > 500 || event.translationY > 90;
      if (movingDown) {
        closing.value = true;
        slide.value = withTiming(DISMISSED_Y, { duration: 240 }, (finished) => {
          if (finished) runOnJS(finishDismiss)();
        });
      } else {
        slide.value = withSpring(0, SPRING);
      }
    })
    .onFinalize((_event, success) => {
      if (!success && !closing.value) slide.value = withSpring(0, SPRING);
    });
  const sheetMotion = useAnimatedStyle(() => ({ transform: [{ translateY: slide.value }] }));
  const backdropMotion = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, slide.value / DISMISSED_Y)) }));

  const shownBalance = confirmation ? balanceAtSend.current ?? balance : balance;
  const empty = shownBalance === 0;
  const send = async () => {
    if (sendingRef.current || confirmation || empty || balance === null) return;
    sendingRef.current = true;
    balanceAtSend.current = balance;
    setSending(true);
    // Paint the spinner before the screen behind reacts to the send: its
    // re-render can take a few hundred ms, and a button that does not react
    // reads as a missed tap.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      await onSend(comment.trim() || null);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const content = (
      <GestureHandlerRootView style={styles.root}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropMotion]} />
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close Rose sheet" />
      <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.wrapper} pointerEvents={confirmation ? 'none' : 'box-none'}>
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(20, insets.bottom + 12) }, sheetMotion]}>
          <GestureDetector gesture={drag}>
          <View collapsable={false}>
          <View collapsable={false} style={styles.dragArea} accessible accessibilityRole="adjustable"
            accessibilityLabel="Rose sheet" accessibilityHint="Swipe down to close"
            accessibilityActions={[{ name: "decrement", label: "Close" }, { name: "escape", label: "Close" }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === "escape" || event.nativeEvent.actionName === "decrement") dismiss();
            }}>
            <View style={styles.handle} />
          </View>
          <View style={styles.header}>
            <View style={styles.badge}>
              <Ionicons name="rose" size={22} color="#fff" />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Send {name} a Rose</Text>
              <Text style={styles.subtitle}>
                {shownBalance === null
                  ? "Checking your Roses…"
                  : empty
                    ? "You're out of Roses. You get 20 more at the start of next week."
                    : `${shownBalance} left this week. A Rose goes to the top of their Likes.`}
              </Text>
            </View>
          </View>
          </View>
          </GestureDetector>

          {!empty && (
            <>
              <TextInput
                style={styles.input}
                value={comment}
                onChangeText={(text) => setComment(text.slice(0, ROSE_COMMENT_MAX))}
                placeholder="Say something (optional)"
                placeholderTextColor="#6E6E73"
                multiline
                maxLength={ROSE_COMMENT_MAX}
                accessibilityLabel="Rose message"
              />
              <Text style={styles.counter}>
                {comment.length}/{ROSE_COMMENT_MAX}
              </Text>
            </>
          )}

          <View style={styles.actions}>
            <Pressable
              onPress={dismiss}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>
                {empty ? "Close" : "Not now"}
              </Text>
            </Pressable>
            {!empty && (
              <Pressable
                onPress={send}
                disabled={sending || balance === null}
                accessibilityRole="button"
                accessibilityLabel={`Send a Rose to ${name}`}
                style={({ pressed }) => [
                  styles.confirm,
                  (sending || balance === null) && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.confirmText}>Send Rose</Text>
                )}
              </Pressable>
            )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
      {visible && celebrating && confirmation && <RoseSentCelebration confirmation={confirmation} photoUri={photoUri}
        bottomInset={insets.bottom} sourceOffsetX={48} onComplete={() => onConfirmationComplete?.()}/>}
      </GestureHandlerRootView>
  );
  if (inline) return visible ? <View style={styles.inline}>{content}</View> : null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
      onDismiss={() => dismissed.current?.()}
    >
      {content}
    </Modal>
  );
});

type HostProps<T> = Omit<Props, "visible" | "name" | "onCancel" | "onSend" | "photoUri"> & {
  onSend: (target: T, comment: string | null) => Promise<void>;
  photoOf?: (target: T) => string | undefined;
  onClose?: () => void;
};

export type RoseSheetHostHandle<T> = {
  open: (target: T) => void;
  close: () => void;
  /** For the hardware back button: true when an open sheet was closed. */
  back: () => boolean;
};

/**
 * Owns who the sheet is for, so opening and closing it re-renders the sheet
 * alone - not the screen and the open profile behind it, which made it slow
 * to appear.
 */
function RoseSheetHostInner<T extends { name: string }>({ onSend, photoOf, onClose, ...props }: HostProps<T>, ref: React.ForwardedRef<RoseSheetHostHandle<T>>) {
  const [target, setTarget] = useState<T | null>(null);
  const sheet = useRef<RoseSheetHandle>(null);
  const close = () => { setTarget(null); onClose?.(); };
  useImperativeHandle(ref, () => ({
    open: setTarget,
    close,
    back: () => {
      if (!target) return false;
      sheet.current?.dismiss();
      return true;
    },
  }));
  return <RoseSheet ref={sheet} {...props} visible={!!target} name={target?.name ?? ""}
    photoUri={target && photoOf ? photoOf(target) : undefined}
    onCancel={close} onSend={(comment) => target ? onSend(target, comment) : Promise.resolve()} />;
}
export const RoseSheetHost = forwardRef(RoseSheetHostInner) as <T extends { name: string }>(
  props: HostProps<T> & { ref?: React.Ref<RoseSheetHostHandle<T>> },
) => React.ReactElement;

const styles = StyleSheet.create({
  root: { flex: 1 },
  inline: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20 },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  wrapper: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#1D1B20",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 0,
    gap: 8,
  },
  dragArea: { height: 32, alignItems: "center", justifyContent: "center" },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#77727C",
  },
  header: { flexDirection: "row", gap: 12, alignItems: "center" },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 3 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  subtitle: { color: "#A1A1A6", fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: "#2C2C2E",
    borderRadius: 14,
    padding: 14,
    minHeight: 84,
    color: "#fff",
    fontSize: 15,
    textAlignVertical: "top",
  },
  counter: { color: "#6E6E73", fontSize: 12, alignSelf: "flex-end", marginTop: -8 },
  actions: { flexDirection: "row", gap: 12, marginTop: 4 },
  cancel: {
    flex: 1,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  confirm: {
    flex: 1.4,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#C2185B",
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
