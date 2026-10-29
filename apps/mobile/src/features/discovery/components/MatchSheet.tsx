import React, { useContext, useEffect, useId, useRef, useState } from 'react';
import { Animated, Image, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { initialWindowMetrics, SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

export type MatchMoment = { name: string; ownPhoto?: string | null; photo?: string | null; sharedInterest?: string | null };
type Props = { match: MatchMoment; onClose: () => void; onSend: (text: string) => Promise<void>; onOpenChat: () => void };

function MatchPhoto({ uri, label }: { uri?: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return uri && !failed
    ? <Image source={{ uri }} style={styles.photo} resizeMode="cover" accessibilityLabel={label} onError={() => setFailed(true)}/>
    : <View style={[styles.photo, styles.photoFallback]} accessible accessibilityLabel={label}><Ionicons name="person" size={52} color="#BDB7C0"/></View>;
}

/** Shared by the app and the browser preview. */
export function MatchContent({ match, onClose, onSend, onOpenChat }: Props) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const entrance = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const input = useRef<TextInput>(null);
  const sendingRef = useRef(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [inputHeight, setInputHeight] = useState(40);
  const tintId = `match-tint-${useId().replace(/:/g, '')}`;
  useEffect(() => {
    if (reduceMotion) { entrance.setValue(1); return; }
    entrance.setValue(0);
    const animation = Animated.timing(entrance, { toValue: 1, duration: 420, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [entrance, reduceMotion]);
  const send = async () => {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError('');
    try { await onSend(content); }
    catch (cause: any) { setError(cause?.response?.data?.message ?? 'Message not sent. Check your connection and tap Send to retry.'); }
    finally { sendingRef.current = false; setSending(false); }
  };
  const starters = [
    { label: 'Photos', text: `What's the story behind your favourite photo?` },
    { label: match.sharedInterest ?? 'Bucket list', text: match.sharedInterest ? `What do you enjoy most about ${match.sharedInterest.toLowerCase()}?` : `What's one thing on your bucket list?` },
    { label: 'Plans next week', text: 'What are you looking forward to next week?' },
  ];
  return <View style={styles.screen}>
    <StatusBar barStyle="light-content" backgroundColor="#100F0D"/>
    <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={`${tintId}-rose`} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="380">
            <Stop offset="0" stopColor="#9F476B" stopOpacity={0.29}/><Stop offset="1" stopColor="#9F476B" stopOpacity={0}/>
          </RadialGradient>
          <RadialGradient id={`${tintId}-amber`} gradientUnits="userSpaceOnUse" cx="390" cy="0" r="240">
            <Stop offset="0" stopColor="#B98754" stopOpacity={0.12}/><Stop offset="1" stopColor="#B98754" stopOpacity={0}/>
          </RadialGradient>
          <RadialGradient id={`${tintId}-plum`} gradientUnits="userSpaceOnUse" cx="390" cy="844" r="420">
            <Stop offset="0" stopColor="#7854A4" stopOpacity={0.27}/><Stop offset="1" stopColor="#7854A4" stopOpacity={0}/>
          </RadialGradient>
          <RadialGradient id={`${tintId}-coral`} gradientUnits="userSpaceOnUse" cx="0" cy="844" r="250">
            <Stop offset="0" stopColor="#A95158" stopOpacity={0.12}/><Stop offset="1" stopColor="#A95158" stopOpacity={0}/>
          </RadialGradient>
        </Defs>
        {['rose', 'amber', 'plum', 'coral'].map(tint => <Rect key={tint} width="390" height="844" fill={`url(#${tintId}-${tint})`}/>)}
      </Svg>
    </View>
    <KeyboardAvoidingView behavior="padding" style={styles.fill}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onClose} disabled={sending} accessibilityRole="button" accessibilityLabel="Close match screen" style={({ pressed }) => [styles.close, styles.closeSurface, pressed && styles.pressed]}><Ionicons name="close" size={30} color="#F6F1F5"/></Pressable>
        <Pressable onPress={() => setMenuOpen(value => !value)} disabled={sending} accessibilityRole="button" accessibilityLabel="Match options" accessibilityState={{expanded: menuOpen}} style={styles.close}><Ionicons name="ellipsis-vertical" size={25} color="#F6F1F5"/></Pressable>
        {menuOpen && <View style={styles.menu}>
          <Pressable accessibilityRole="button" onPress={() => { setMenuOpen(false); onOpenChat(); }} style={styles.menuItem}><Text style={styles.menuText}>Open chat</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.menuItem}><Text style={styles.menuText}>Keep browsing</Text></Pressable>
        </View>}
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.main} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={[styles.art, { height: Math.min(300, Math.max(220, height * 0.32)) }]}>
          <Animated.View style={[styles.photoFrame, styles.leftPhoto, { opacity: entrance, transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }, { rotate: '-9deg' }] }]}><MatchPhoto uri={match.ownPhoto} label="Your profile photo"/></Animated.View>
          <Animated.View style={[styles.photoFrame, styles.rightPhoto, { opacity: entrance, transform: [{ translateX: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }, { rotate: '9deg' }] }]}><MatchPhoto uri={match.photo} label={`${match.name}'s profile photo`}/></Animated.View>
          <Animated.View style={[styles.matchIcon, { opacity: entrance, transform: [{ scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}><MaterialCommunityIcons name="bullseye-arrow" size={43} color="#FFFFFF"/></Animated.View>
        </View>
        <Text accessibilityRole="header" style={styles.title}>What a match!</Text>
        <Text style={styles.body}>You and {match.name} liked each other.{'\n'}Send a message to start the chat.</Text>
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.suggestion}>
          <View style={styles.suggestionIcon}><Ionicons name="bulb" size={17} color="#FFCA80"/></View>
          <View style={styles.suggestionCopy}>
            <Text style={styles.suggestionText}>Make it personal. Ask about their:</Text>
            <View style={styles.chips}>{starters.map(starter => <Pressable key={starter.label} accessibilityRole="button" accessibilityLabel={`Use a question about ${starter.label}`} disabled={sending} onPress={() => { setText(starter.text); setError(''); input.current?.focus(); }} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}><Text style={styles.chipText}>{starter.label}</Text></Pressable>)}</View>
          </View>
        </View>
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>}
        <View style={[styles.composer, !!error && styles.composerError]}>
          <TextInput ref={input} value={text} onChangeText={value => { setText(value); setError(''); }} onContentSizeChange={event => setInputHeight(Math.max(40, Math.min(112, event.nativeEvent.contentSize.height)))} placeholder="Send a message…" placeholderTextColor="#ADA2AA" keyboardAppearance="dark" accessibilityLabel={`Message ${match.name}`} multiline maxLength={2000} editable={!sending} style={[styles.input, {height: inputHeight}]}/>
          <Pressable onPress={() => void send()} disabled={!text.trim() || sending} accessibilityRole="button" accessibilityLabel={sending ? 'Sending message' : error ? 'Retry message' : 'Send message'} accessibilityState={{ disabled: !text.trim() || sending, busy: sending }} hitSlop={4} style={({ pressed }) => [styles.send, sending && styles.sendDisabled, pressed && styles.pressed]}><Ionicons name={sending ? 'ellipsis-horizontal' : 'send'} size={21} color="#222222"/></Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  </View>;
}

/** The development reminder tour uses a modal. Real matches use a stack screen. */
export function MatchSheet({ match, onSayHi, onClose }: { match: MatchMoment | null; onSayHi: () => void; onClose: () => void }) {
  return <Modal visible={!!match} animationType="fade" statusBarTranslucent onRequestClose={onClose}>{match && <MatchContent match={match} onClose={onClose} onOpenChat={onSayHi} onSend={async () => onSayHi()}/>}</Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#100F0D', overflow: 'hidden' },
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 6, zIndex: 5 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  closeSurface: { backgroundColor: 'rgba(255,255,255,0.08)' },
  menu: { position: 'absolute', right: 16, top: 76, minWidth: 168, paddingVertical: 4, backgroundColor: '#292329', borderRadius: 16, borderWidth: 1, borderColor: '#453A42', elevation: 8, boxShadow: '0px 4px 20px #00000030' },
  menuItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18 },
  menuText: { fontFamily: 'DMSans_500Medium', fontSize: 14, color: '#F6F1F5' },
  scroll: { flex: 1 },
  main: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22, paddingTop: 20, paddingBottom: 28 },
  art: { width: '100%', maxWidth: 390, alignSelf: 'center', marginBottom: 20 },
  photoFrame: { position: 'absolute', width: '44%', height: '84%', top: '6%', borderRadius: 24, backgroundColor: '#2C252B', overflow: 'hidden' },
  leftPhoto: { left: '5%', zIndex: 1 }, rightPhoto: { right: '5%', zIndex: 2 },
  photo: { width: '100%', height: '100%' },
  photoFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#2C252B' },
  matchIcon: { position: 'absolute', bottom: '1%', left: '50%', marginLeft: -30, width: 60, height: 60, borderRadius: 30, backgroundColor: '#222222', alignItems: 'center', justifyContent: 'center', zIndex: 3 },
  title: { fontFamily: 'DMSans_700Bold', fontSize: 28, lineHeight: 36, letterSpacing: -0.7, textAlign: 'center', color: '#F6F1F5' },
  body: { fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 24, textAlign: 'center', color: '#C7BDC5', marginTop: 12, maxWidth: 340 },
  footer: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 12, gap: 18 },
  suggestion: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 14, paddingVertical: 15, borderRadius: 24, backgroundColor: '#282329' },
  suggestionIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#493523' },
  suggestionCopy: { flex: 1, gap: 6 },
  suggestionText: { fontFamily: 'DMSans_400Regular', fontSize: 13, lineHeight: 20, color: '#C7BDC5' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 38, justifyContent: 'center', borderRadius: 20, paddingHorizontal: 10, backgroundColor: '#3A333B' },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: '#F6F1F5' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 5, paddingLeft: 17, minHeight: 52, borderRadius: 28, borderWidth: 1, borderColor: '#51454F', backgroundColor: '#211D22', gap: 8 },
  composerError: { borderColor: '#FF9AA2' },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingVertical: 9, paddingHorizontal: 0, fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 22, color: '#F6F1F5', textAlignVertical: 'center' },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FF9D45', alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.55 },
  error: { fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#FF9AA2' }, pressed: { opacity: 0.65 },
});
