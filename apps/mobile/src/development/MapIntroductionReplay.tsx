import React, {useCallback, useState} from 'react';
import {BackHandler, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {MapIntroduction} from '../features/location/MapIntroduction';

/** Local replay. Does not change the account's first-map state. */
export function MapIntroductionReplay() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const stop = useCallback(() => setPlaying(false), []);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!playing) return false;
      stop();
      return true;
    });
    return () => subscription.remove();
  }, [playing, stop]));
  return <View style={s.page}>
    {!playing && <StatusBar barStyle="dark-content" backgroundColor="#F1EDE4"/>}
    <View style={[s.content, {paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24}]}
      pointerEvents={playing ? 'none' : 'auto'} accessibilityElementsHidden={playing}
      importantForAccessibility={playing ? 'no-hide-descendants' : 'auto'}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close preview" onPress={() => navigation.goBack()} style={s.close}>
        <Ionicons name="close" size={24} color="#352335"/>
      </Pressable>
      <View style={s.center}>
        <Ionicons name="map-outline" size={56} color="#712C48"/>
        <Text style={s.title}>Map preview</Text>
        <Text style={s.description}>Tap to watch the four corners open, then see the map fill the screen.</Text>
        <Pressable accessibilityRole="button" onPress={() => {setPlayed(true); setPlaying(true);}}
          style={({pressed}) => [s.button, {opacity: pressed ? .7 : 1}]}>
          <Ionicons name={played ? 'refresh' : 'play'} size={19} color="#FFF"/>
          <Text style={s.buttonText}>{played ? 'Replay animation' : 'Play animation'}</Text>
        </Pressable>
      </View>
    </View>
    {playing && <MapIntroduction onComplete={stop} onClose={stop}/>}
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#F1EDE4'},
  content: {flex: 1, paddingHorizontal: 24},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end'},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 38, lineHeight: 46, color: '#352335'},
  description: {fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 23, color: '#715365', textAlign: 'center', maxWidth: 290},
  button: {minHeight: 52, paddingHorizontal: 26, borderRadius: 26, backgroundColor: '#712C48', flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12},
  buttonText: {fontFamily: 'DMSans_700Bold', fontSize: 15, color: '#FFF'},
});
