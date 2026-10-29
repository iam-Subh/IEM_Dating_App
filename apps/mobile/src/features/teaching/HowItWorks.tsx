import React from 'react';
import { Image, ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TEACH_ART } from './teachArt';

type Topic = {
  art: ImageSourcePropType;
  title: string;
  body: string;
  /** Where in the app it lives, in the words the app itself uses. */
  where: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

// In the order people meet them: find someone, get noticed, talk; then trust and safety.
const GROUPS: { label: string; topics: Topic[] }[] = [
  { label: 'Meeting people', topics: [
    { art: TEACH_ART.explore, title: 'Swipe through people', icon: 'compass-outline', where: 'Explore',
      body: 'Swipe right to like, left to pass. Tap the arrow on a card to see their whole profile.' },
    { art: TEACH_ART.comments, title: 'Comment on a photo or bio', icon: 'compass-outline', where: 'Explore, on an open profile',
      body: 'Tap the comment button on a photo or their bio. Your comment goes with your like.' },
    { art: TEACH_ART.stories, title: 'Share a Story', icon: 'compass-outline', where: 'Explore, your ring at the top',
      body: 'Post a photo for people on campus to see. A Story is live for 24 hours.' },
    { art: TEACH_ART.likes, title: 'See who likes you', icon: 'heart-outline', where: 'Connections, Likes you',
      body: 'Everyone who liked you, with any comment or Rose they sent. Like back to match.' },
    { art: TEACH_ART.chats, title: 'Chat once you match', icon: 'chatbubble-outline', where: 'Chats',
      body: 'When you both like each other, say hi. Send messages, photos or a voice note.' },
  ] },
  { label: 'Trust and safety', topics: [
    { art: TEACH_ART.verify, title: 'Get your blue tick', icon: 'person-outline', where: 'Profile',
      body: 'Verify your college email. Verified profiles show a blue tick, so people know you study here.' },
    { art: TEACH_ART.hidePlace, title: 'Hide at a place', icon: 'settings-outline', where: 'Settings, Location',
      body: 'Pick places, like your hostel, where you won’t show up to people nearby.' },
    { art: TEACH_ART.safety, title: 'Block or report', icon: 'shield-outline', where: 'The menu on any profile or chat',
      body: 'If someone makes you uncomfortable, block or report them. Our team reviews every report.' },
    { art: TEACH_ART.shake, title: 'Shake to report a bug', icon: 'settings-outline', where: 'Turn off in Settings, App settings',
      body: 'Something broken? Shake your phone and tell us what happened.' },
  ] },
];

/** "How IEM Connect works": every main feature, what it's for and where it is. */
export function HowItWorksContent({ onClose, topInset = 0, bottomInset = 0 }: {
  onClose: () => void;
  topInset?: number;
  bottomInset?: number;
}) {
  return <View style={[styles.page, { paddingTop: topInset + 4 }]}>
    <View style={styles.header}>
      <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
        <Ionicons name="close" size={24} color="#F6F1EC" />
      </Pressable>
      <Text accessibilityRole="header" style={styles.navTitle}>Guide</Text>
      <View style={styles.headerSpace} />
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset + 24 }]}>
      <View style={styles.content}>
        <View style={styles.intro}>
          <Image source={TEACH_ART.cover} style={styles.cover} resizeMode="contain" accessible={false} />
          <Text accessibilityRole="header" style={styles.heading}>How IEM Connect works</Text>
          <Text style={styles.lead}>The basics, in a minute.</Text>
        </View>
        {GROUPS.map((group) => <View key={group.label} style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupLabel}>{group.label}</Text>
          {group.topics.map((topic) => <View key={topic.title} style={styles.topic}
            accessible accessibilityLabel={`${topic.title}. ${topic.body} Where: ${topic.where}.`}>
            <Image source={topic.art} style={styles.art} resizeMode="contain" accessible={false} />
            <View style={styles.text}>
              <Text style={styles.title}>{topic.title}</Text>
              <Text style={styles.body}>{topic.body}</Text>
              <View style={styles.where}>
                <Ionicons name={topic.icon} size={13} color="#E9B7C2" />
                <Text style={styles.whereText}>{topic.where}</Text>
              </View>
            </View>
          </View>)}
        </View>)}
        <Pressable onPress={onClose} accessibilityRole="button"
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}>
          <Text style={styles.doneText}>Got it</Text>
        </Pressable>
      </View>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D' },
  header: { height: 52, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSpace: { width: 44 },
  navTitle: { flex: 1, color: '#F6F1EC', fontFamily: 'DMSans_700Bold', fontSize: 17, textAlign: 'center' },
  scroll: { flexGrow: 1, paddingHorizontal: 16 },
  content: { width: '100%', maxWidth: 480, alignSelf: 'center' },
  intro: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  cover: { width: 176, height: 176, marginBottom: 12 },
  heading: { color: '#F4EEE5', fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 33, lineHeight: 39,
    textAlign: 'center', paddingBottom: 6, includeFontPadding: true },
  lead: { color: '#C7BFB6', fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  group: { marginTop: 20 },
  groupLabel: { color: '#9D958D', fontFamily: 'DMSans_700Bold', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase',
    marginBottom: 10, marginLeft: 4 },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 20, backgroundColor: '#1A1816', marginBottom: 10 },
  art: { width: 84, height: 84 },
  text: { flex: 1 },
  title: { color: '#F4EEE5', fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 21 },
  body: { color: '#C7BFB6', fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, marginTop: 3 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  whereText: { flex: 1, color: '#E9B7C2', fontFamily: 'DMSans_500Medium', fontSize: 12, lineHeight: 16 },
  done: { alignSelf: 'center', minWidth: 140, minHeight: 48, paddingHorizontal: 26, borderRadius: 24,
    backgroundColor: '#F7D8E0', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  doneText: { color: '#3A222B', fontFamily: 'DMSans_700Bold', fontSize: 15 },
  pressed: { opacity: 0.72 },
});
