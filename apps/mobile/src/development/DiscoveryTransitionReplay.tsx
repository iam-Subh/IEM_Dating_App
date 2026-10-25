import React, {useSyncExternalStore} from 'react';
import {Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Ionicons} from '@expo/vector-icons';
import {DiscoveryArrival} from '../features/discovery/components/DiscoveryArrival';
import {getDiscoveryArrival, startDiscoveryArrival, subscribeDiscoveryArrival} from '../features/discovery/discoveryArrival';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {demoProfiles} from '../features/discovery/demo/demoProfiles';

export function DiscoveryTransitionReplay() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const arrival = useSyncExternalStore(subscribeDiscoveryArrival, getDiscoveryArrival);
  const play = () => {
    // Replay the successful transition without changing the account or its draft.
    startDiscoveryArrival(true, demoProfiles);
  };
  return <View style={[s.page, {paddingTop: insets.top, paddingBottom: insets.bottom + 24}]}>
    {!arrival.active && <StatusBar barStyle="dark-content" backgroundColor="#F2F3EE"/>}
    <Pressable accessibilityRole="button" accessibilityLabel="Close transition replay" onPress={() => navigation.goBack()} style={s.close}><Ionicons name="close" size={23} color="#352335"/></Pressable>
    <View style={s.content}><Ionicons name="albums-outline" size={52} color="#712C48"/><Text style={s.title}>Ready to discover?</Text><Text style={s.description}>Tap below to watch the Discovery transition.</Text>
      <Pressable accessibilityRole="button" onPress={play} style={s.button}><Text style={s.buttonText}>Start discovering</Text><Ionicons name="arrow-forward" size={20} color="#FFF"/></Pressable>
    </View>
    <DiscoveryArrival preview/>
  </View>;
}
const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F2F3EE', paddingHorizontal: 24},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end', marginTop: 8},
  content: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 36, lineHeight: 44, color: '#352335', textAlign: 'center'},
  description: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, color: '#715365', textAlign: 'center'},
  button: {minHeight: 52, borderRadius: 26, backgroundColor: '#712C48', paddingHorizontal: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 12},
  buttonText: {fontFamily: 'DMSans_700Bold', fontSize: 15, color: '#FFF'},
});
