import React, {useContext} from 'react';
import {Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions, type ImageSourcePropType} from 'react-native';
import {SafeAreaInsetsContext, initialWindowMetrics} from 'react-native-safe-area-context';
import {closeAccountGoodbye, useAccountGoodbye} from '../accountGoodbye';

const palette = {
  canvas: '#0D0D0F', text: '#F5F3F7', secondary: '#B4B2BB',
  muted: '#929098', accent: '#E8CBC4', onAccent: '#32251F',
};
type Preview = {scheduledFor: string; onDone: () => void};
type ContentProps = {scheduledFor: string | null; onDone: () => void; topInset?: number; bottomInset?: number; artwork?: ImageSourcePropType};

/** Account status comes from the deletion response. The demo supplies its own date. */
export function AccountGoodbyeScreen({preview}: {preview?: Preview} = {}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? {top: 0, bottom: 0, left: 0, right: 0};
  const stored = useAccountGoodbye();
  return <AccountGoodbyeContent scheduledFor={(preview ?? stored)?.scheduledFor ?? null}
    onDone={preview?.onDone ?? closeAccountGoodbye} topInset={insets.top} bottomInset={insets.bottom}/>;
}

/** Presentation only. Done keeps the existing navigation and account behaviour. */
export function AccountGoodbyeContent({scheduledFor, onDone, topInset = 0, bottomInset = 0, artwork}: ContentProps) {
  const {height} = useWindowDimensions();
  const parsed = scheduledFor ? new Date(scheduledFor) : null;
  const date = parsed && Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'}) : null;
  const compact = height < 720;
  return <View style={[styles.page, {paddingTop: topInset}]}>
    <StatusBar barStyle="light-content" backgroundColor={palette.canvas}/>
    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, compact && styles.compactContent]}>
      <Image source={artwork ?? require('../../../../assets/illustrations/account-closed-envelope-2d.png')}
        resizeMode="contain" style={[styles.art, compact && styles.compactArt]} accessible={false}/>
      <Text style={styles.title} accessibilityRole="header">Account deletion scheduled</Text>
      <View style={styles.timeline}>
        <View style={styles.statusRow}>
          <View style={styles.markerColumn} accessible={false}>
            <View style={styles.currentDot}/><View style={styles.connector}/>
          </View>
          <View style={styles.statusCopy}>
            <Text style={styles.now}>Now</Text>
            <Text style={styles.statusTitle}>Profile hidden</Text>
            <Text style={styles.statusNote}>Others cannot find or message you.</Text>
          </View>
        </View>
        <View style={styles.statusRow}>
          <View style={styles.markerColumn} accessible={false}><View style={styles.futureDot}/></View>
          <View style={styles.statusCopy}>
            <Text style={styles.date}>{date ?? 'In 30 days'}</Text>
            <Text style={styles.statusTitle}>Permanently deleted</Text>
            <Text style={styles.statusNote}>Your photos, matches, chats and stories will be deleted.</Text>
          </View>
        </View>
      </View>
      <Text style={styles.recoveryText}>
        To cancel deletion, {date ? 'sign in before this date' : 'sign in within 30 days'} and select <Text style={styles.emphasis}>Keep my account</Text>.
      </Text>
    </ScrollView>
    <View style={[styles.footer, {paddingBottom: bottomInset + 16}]}>
      <Pressable accessibilityRole="button" onPress={onDone} style={({pressed}) => [styles.primary, pressed && styles.pressed]}>
        <Text style={styles.primaryText}>Done</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: palette.canvas},
  scroll: {flex: 1},
  content: {flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, maxWidth: 480, width: '100%', alignSelf: 'center'},
  compactContent: {justifyContent: 'flex-start', paddingTop: 12},
  art: {width: 210, height: 160, alignSelf: 'center', marginBottom: 24},
  compactArt: {width: 180, height: 130, marginBottom: 18},
  title: {fontFamily: 'DMSans_700Bold', fontSize: 28, lineHeight: 34, letterSpacing: -0.5, color: palette.text},
  timeline: {marginTop: 28, gap: 24},
  statusRow: {flexDirection: 'row', gap: 14},
  markerColumn: {width: 10, alignItems: 'center', position: 'relative'},
  currentDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent, marginTop: 5},
  futureDot: {width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: palette.muted, marginTop: 6},
  connector: {position: 'absolute', width: 1, top: 17, bottom: -24, backgroundColor: '#35343A'},
  statusCopy: {flex: 1, gap: 5},
  now: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: palette.accent},
  date: {fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 18, color: palette.secondary},
  statusTitle: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 22, color: palette.text},
  statusNote: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: palette.secondary},
  recoveryText: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 19, color: palette.secondary, marginTop: 26},
  emphasis: {fontFamily: 'DMSans_500Medium', color: palette.text},
  footer: {paddingTop: 12, paddingHorizontal: 24, maxWidth: 480, width: '100%', alignSelf: 'center'},
  primary: {minHeight: 50, borderRadius: 25, backgroundColor: palette.accent, justifyContent: 'center', alignItems: 'center'},
  primaryText: {fontFamily: 'DMSans_700Bold', fontSize: 15, color: palette.onAccent},
  pressed: {opacity: 0.8},
});
