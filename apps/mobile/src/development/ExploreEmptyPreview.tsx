import React from 'react';
import {Image, Pressable, ScrollView, StyleSheet, Text} from 'react-native';
import {StandoutsIcon} from '../features/discovery/components/StandoutsIcon';

/** The existing Explore empty design, with demo-only actions. */
export function ExploreEmptyPreview({onPreferences, onStandouts, onRetry}: {
  onPreferences: () => void; onStandouts: () => void; onRetry: () => void;
}) {
  return <ScrollView style={StyleSheet.absoluteFill} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} testID="explore-empty-state">
    <Image source={require('../../assets/illustrations/discover-kitten.png')} style={styles.kitten}
      resizeMode="contain" fadeDuration={0} accessible={false} testID="explore-empty-kitten"/>
    <Text style={styles.title} accessibilityRole="header">You've seen everyone</Text>
    <Text style={styles.body}>New people join every day. Widen who you see, or look at today's Standouts.</Text>
    <Pressable accessibilityRole="button" onPress={onPreferences} style={styles.primary}><Text style={styles.primaryText}>Widen my preferences</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={onStandouts} style={styles.secondary}>
      <StandoutsIcon size={24} color="#E8C698" heartColor="#F2BDC9"/><Text style={styles.secondaryText}>See today's Standouts</Text>
    </Pressable>
    <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Check again</Text></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: {flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 18},
  kitten: {width: 124, height: 186, marginBottom: 16},
  title: {fontFamily: 'DMSans_700Bold', fontSize: 24, lineHeight: 30, color: '#FFF', marginBottom: 8, textAlign: 'center'},
  body: {fontFamily: 'DMSans_400Regular', fontSize: 16, lineHeight: 24, color: 'rgba(255,255,255,0.5)', textAlign: 'center'},
  primary: {alignSelf: 'stretch', minHeight: 52, borderRadius: 26, marginTop: 24, backgroundColor: '#F3C1CA', alignItems: 'center', justifyContent: 'center'},
  primaryText: {fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#331C23'},
  secondary: {alignSelf: 'stretch', minHeight: 52, borderRadius: 26, marginTop: 10, flexDirection: 'row', gap: 8, borderWidth: 1,
    borderColor: 'rgba(255,210,122,0.45)', backgroundColor: '#2A2620', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8},
  secondaryText: {fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#FFE3AE', flexShrink: 1, textAlign: 'center'},
  retry: {marginTop: 6, minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center'},
  retryText: {fontFamily: 'DMSans_500Medium', fontSize: 15, color: 'rgba(255,255,255,0.7)'},
});
