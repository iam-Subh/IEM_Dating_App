import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "react-redux";
import type { RootState } from "../../../store";
import { api } from "../../../services/api";
import { colors } from "../../../core/theme/colors";
import { COMMENT_MAX, type CommentAbout } from "./commentTypes";

const SPRING = { damping: 28, stiffness: 300, overshootClamping: true };
const DISMISSED_Y = 800;

const STARTERS: Record<CommentAbout["kind"], string[]> = {
  photo: ["Where was this taken?", "Okay, this photo is great", "What's the story here?"],
  bio: ["Tell me more about this", "Same here, honestly", "I have to ask about this"],
};

function NotePhoto({uri, style}: {uri?: string | null; style: object}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return uri && !failed
    ? <Image source={{uri}} style={style} resizeMode="cover" onError={() => setFailed(true)} accessible={false}/>
    : <View style={[style, styles.photoFallback]} accessible={false}><Ionicons name="person" size={18} color="#A69D97"/></View>;
}

function profileAvatar(profile: any): string | null {
  const first = profile?.photos?.[0];
  const value = profile?.avatarUrl ?? profile?.avatar ?? (typeof first === 'string' ? first : first?.photoUrl);
  return typeof value === 'string' && value ? value : null;
}

export type CommentSend = (kind: "like" | "rose", comment: string | null, about: CommentAbout) => Promise<string | null>;

type Props = {
  name: string;
  about: CommentAbout | null;
  ownPhoto?: string | null;
  targetPhoto?: string | null;
  onCancel: () => void;
  /** Resolves with a message to show under the box, or null once it was sent (or explained elsewhere). */
  onSend: CommentSend;
};

export type CommentSheetHandle = { dismiss: () => void };

/**
 * Commenting on one photo or the bio, from the open profile (as on Hinge):
 * the reply context, the sender's avatar, and the note sent with a Like.
 * Drawn inside the profile's own window, like
 * the Rose sheet, so it opens at once. A refused comment is explained right
 * here, before anything leaves.
 */
export const CommentSheet = forwardRef<CommentSheetHandle, Props>(function CommentSheet({ name, about, ownPhoto, targetPhoto, onCancel, onSend }, ref) {
  const insets = useSafeAreaInsets();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<"like" | null>(null);
  const sendingRef = useRef(false);
  const slide = useSharedValue(DISMISSED_Y);
  const dragStart = useSharedValue(0);
  const closing = useSharedValue(false);
  const visible = !!about;

  // A fresh sheet each time: the last person's words must not follow.
  useLayoutEffect(() => {
    if (!visible) return;
    setComment("");
    setError(null);
    setSending(null);
    closing.value = false;
    slide.value = DISMISSED_Y;
    slide.value = withSpring(0, SPRING);
  }, [visible, about, slide, closing]);

  const finishDismiss = () => {
    Keyboard.dismiss();
    onCancel();
  };
  const dismiss = () => {
    if (closing.value || sendingRef.current) return;
    closing.value = true;
    slide.value = withTiming(DISMISSED_Y, { duration: 240 }, (finished) => {
      if (finished) runOnJS(finishDismiss)();
    });
  };
  useImperativeHandle(ref, () => ({ dismiss }));
  const drag = Gesture.Pan()
    .enabled(!sending)
    .activeOffsetY([-8, 8])
    .onStart(() => { dragStart.value = slide.value; })
    .onUpdate((event) => {
      if (!closing.value) slide.value = Math.max(0, Math.min(DISMISSED_Y, dragStart.value + event.translationY));
    })
    .onEnd((event) => {
      if (closing.value) return;
      if (event.velocityY > 500 || event.translationY > 90) {
        closing.value = true;
        slide.value = withTiming(DISMISSED_Y, { duration: 240 }, (finished) => {
          if (finished) runOnJS(finishDismiss)();
        });
      } else slide.value = withSpring(0, SPRING);
    })
    .onFinalize((_event, success) => {
      if (!success && !closing.value) slide.value = withSpring(0, SPRING);
    });
  const sheetMotion = useAnimatedStyle(() => ({ transform: [{ translateY: slide.value }] }));
  const backdropMotion = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, slide.value / DISMISSED_Y)) }));

  const send = async () => {
    const text = comment.trim();
    if (!about || !text || sendingRef.current) return;
    sendingRef.current = true;
    setSending("like");
    setError(null);
    // Paint the spinner before the deck behind reacts to the send.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      const problem = await onSend("like", text, about);
      if (problem) setError(problem);
    } finally {
      sendingRef.current = false;
      setSending(null);
    }
  };

  if (!about) return null;
  const photo = about.kind === "photo" ? about.photoUrl : null;
  const canSend = comment.trim().length > 0 && !sending;
  return (
    <View style={styles.inline}>
      <GestureHandlerRootView style={styles.root}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropMotion]} />
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close comment" />
        <KeyboardAvoidingView behavior="padding" automaticOffset style={styles.wrapper} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { paddingBottom: Math.max(14, insets.bottom + 8) }, sheetMotion]}>
            <GestureDetector gesture={drag}>
              <View collapsable={false}>
                <View style={styles.header}>
                  <View style={styles.headerSpacer}/>
                  <Text style={styles.title} accessibilityRole="header" numberOfLines={2}>Write a note to {name}</Text>
                  <Pressable onPress={dismiss} disabled={!!sending} accessibilityRole="button" accessibilityLabel="Close note" style={({pressed}) => [styles.close, pressed && styles.pressed]}>
                    <Ionicons name="close" size={25} color="#F6F2EF"/>
                  </Pressable>
                </View>
              </View>
            </GestureDetector>

            <View style={styles.replyCard}>
              <View style={styles.quoteBar}/>
              <View style={styles.replyCopy}>
                <Text style={styles.replyTitle}>Send a reply</Text>
                <Text style={styles.replySubtitle}>{photo ? 'To their photo' : 'To their bio'}</Text>
                {about.kind === 'bio' && <Text style={styles.quoteText} numberOfLines={2}>{about.text}</Text>}
              </View>
              <NotePhoto uri={photo ?? targetPhoto} style={styles.thumb}/>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={styles.starterScroll} contentContainerStyle={styles.starters}>
              {STARTERS[about.kind].map(line => <Pressable key={line} disabled={!!sending} onPress={() => {setComment(line); setError(null);}} accessibilityRole="button" accessibilityLabel={`Start with: ${line}`} hitSlop={{top: 5, bottom: 5}} style={({pressed}) => [styles.starter, pressed && styles.pressed]}>
                <Text style={styles.starterText} numberOfLines={1}>{line}</Text>
              </Pressable>)}
            </ScrollView>

            <View style={[styles.inputBox, !!error && styles.inputError]}>
              <View style={styles.composerRow}>
                <NotePhoto uri={ownPhoto} style={styles.avatar}/>
                <TextInput
                style={styles.input}
                value={comment}
                onChangeText={(text) => { setComment(text.slice(0, COMMENT_MAX)); if (error) setError(null); }}
                placeholder={photo ? "Ask about this photo…" : "Reply to what they wrote…"}
                placeholderTextColor="#B5ABA3"
                multiline
                scrollEnabled
                keyboardAppearance="dark"
                editable={!sending}
                maxLength={COMMENT_MAX}
                accessibilityLabel="Your comment"
              />
              </View>
              <Text style={[styles.counter, comment.length >= COMMENT_MAX - 10 && styles.counterNear]}>
                {COMMENT_MAX - comment.length}
              </Text>
            </View>
            {error ? (
              <View style={styles.errorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle" size={16} color="#FF8A9D" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : (
              <View style={styles.privacyRow}>
                <Ionicons name="lock-closed-outline" size={12} color="#A69D97" />
                <Text style={styles.privacyText}>Only {name} sees it. No links or contact details.</Text>
              </View>
            )}

            <View style={styles.actions}>
              <View style={styles.likeHint}><Ionicons name="heart" size={14} color="#C7BBB4"/><Text style={styles.likeHintText}>Sent with your like</Text></View>
              <Pressable onPress={() => void send()} disabled={!canSend} accessibilityRole="button" accessibilityState={{disabled: !canSend, busy: !!sending}}
                accessibilityLabel={comment.trim() ? `Send like with comment to ${name}` : `Send like to ${name}`}
                style={({ pressed }) => [styles.like, !canSend && styles.disabled, pressed && styles.pressed]}>
                {sending === "like" ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Ionicons name="send" size={22} color={canSend ? "#FFFFFF" : "#8E8883"} />
                  </>
                )}
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </View>
  );
});

type HostProps<T> = Omit<Props, "name" | "about" | "ownPhoto" | "targetPhoto" | "onCancel" | "onSend"> & {
  onSend: (target: T, kind: "like" | "rose", comment: string | null, about: CommentAbout) => Promise<string | null>;
};

export type CommentSheetHostHandle<T> = {
  open: (target: T, about: CommentAbout) => void;
  close: () => void;
  /** For the hardware back button: true when an open sheet was closed. */
  back: () => boolean;
};

/** Owns who the sheet is for, so opening it re-renders the sheet alone - as RoseSheetHost does. */
function CommentSheetHostInner<T extends { name: string; primaryPhoto?: string | null; avatarUrl?: string | null; photos?: string[] }>({ onSend, ...props }: HostProps<T>, ref: React.ForwardedRef<CommentSheetHostHandle<T>>) {
  const [open, setOpen] = useState<{ target: T; about: CommentAbout } | null>(null);
  const sheet = useRef<CommentSheetHandle>(null);
  const user = useSelector((state: RootState) => state.auth.user);
  const [fetchedAvatar, setFetchedAvatar] = useState<{userId: string; url: string | null} | null>(null);
  const userId = user?.id as string | undefined;
  const visible = !!open;
  useEffect(() => {
    if (!visible || !userId) return;
    let active = true;
    api.get('/profile').then(response => {
      if (active) setFetchedAvatar({userId, url: profileAvatar(response.data.data)});
    }).catch(() => undefined);
    return () => { active = false; };
  }, [visible, userId]);
  const ownPhoto = fetchedAvatar?.userId === userId ? fetchedAvatar?.url : profileAvatar(user);
  const targetPhoto = open?.target.primaryPhoto ?? open?.target.photos?.[0] ?? open?.target.avatarUrl ?? null;
  useImperativeHandle(ref, () => ({
    open: (target, about) => setOpen({ target, about }),
    close: () => setOpen(null),
    back: () => {
      if (!open) return false;
      sheet.current?.dismiss();
      return true;
    },
  }));
  // Leaving with the profile: nothing is left open behind it.
  useEffect(() => () => Keyboard.dismiss(), []);
  return <CommentSheet ref={sheet} {...props} name={open?.target.name ?? ""} about={open?.about ?? null} ownPhoto={ownPhoto} targetPhoto={targetPhoto}
    onCancel={() => setOpen(null)}
    onSend={(kind, comment, about) => open ? onSend(open.target, kind, comment, about) : Promise.resolve(null)} />;
}
export const CommentSheetHost = forwardRef(CommentSheetHostInner) as <T extends { name: string; primaryPhoto?: string | null; avatarUrl?: string | null; photos?: string[] }>(
  props: HostProps<T> & { ref?: React.Ref<CommentSheetHostHandle<T>> },
) => React.ReactElement;

const styles = StyleSheet.create({
  inline: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, elevation: 20 },
  root: { flex: 1 },
  backdrop: { backgroundColor: "rgba(0,0,0,0.6)" },
  wrapper: { flex: 1, justifyContent: "flex-end" },
  sheet: { backgroundColor: "#111110", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, gap: 12 },
  header: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 8 },
  headerSpacer: { width: 40 },
  title: { flex: 1, color: "#F6F2EF", fontSize: 17, lineHeight: 23, textAlign: "center", fontWeight: "700", paddingVertical: 12 },
  close: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#252322" },
  replyCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 16, backgroundColor: "#242221" },
  replyCopy: { flex: 1, minWidth: 0, gap: 2 },
  quoteBar: { width: 2, alignSelf: "stretch", borderRadius: 2, backgroundColor: "#BDB0A7" },
  replyTitle: { color: "#F6F2EF", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  replySubtitle: { color: "#C7BBB4", fontSize: 13, lineHeight: 18 },
  quoteText: { color: "#ACA099", fontSize: 12, lineHeight: 17, marginTop: 2 },
  thumb: { width: 54, height: 54, borderRadius: 12, backgroundColor: "#302C29" },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#302C29" },
  photoFallback: { alignItems: "center", justifyContent: "center" },
  starterScroll: { flexGrow: 0, flexShrink: 0 },
  starters: { flexDirection: "row", gap: 6, paddingVertical: 5 },
  starter: { paddingHorizontal: 11, height: 32, borderRadius: 16, justifyContent: "center", backgroundColor: "#3B3733" },
  starterText: { color: "#F0E8E2", fontSize: 12, fontWeight: "600" },
  inputBox: { backgroundColor: "#35322F", paddingHorizontal: 12, paddingTop: 10, paddingBottom: 7, borderWidth: 1, borderColor: "transparent", borderRadius: 14 },
  composerRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  inputError: { borderColor: "#FF8A9D" },
  input: { flex: 1, height: 58, color: "#F6F2EF", fontSize: 15, lineHeight: 21, textAlignVertical: "top", paddingHorizontal: 0, paddingTop: 4, paddingBottom: 0 },
  counter: { alignSelf: "flex-end", color: "#A69D97", fontSize: 11, lineHeight: 14, marginTop: 2 },
  counterNear: { color: "#FFB4A8" },
  errorRow: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: -4 },
  errorText: { flex: 1, color: "#FF8A9D", fontSize: 12, lineHeight: 17 },
  privacyRow: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: -4 },
  privacyText: { flex: 1, color: "#A69D97", fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "center", paddingTop: 12, marginHorizontal: -16, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: "#2C2825" },
  likeHint: { flexDirection: "row", gap: 6, alignItems: "center" },
  likeHintText: { color: "#C7BBB4", fontSize: 12 },
  like: { width: 48, height: 44, borderRadius: 14, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  disabled: { backgroundColor: "#34312F" },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
