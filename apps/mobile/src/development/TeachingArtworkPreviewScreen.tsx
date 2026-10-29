import React, {useState} from 'react';
import {FlatList, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {GestureTeachingHand, type TeachingGesturePose} from '../features/teaching/GestureTeachingHand';
import {TeachingArt, teachingArtworkCatalog} from '../features/teaching/TeachingArt';

const poses: {pose: TeachingGesturePose; text: string}[] = [
  {pose: 'point', text: 'Tap to open a story.'},
  {pose: 'hold', text: 'Hold to pause.'},
  {pose: 'swipe', text: 'Swipe right to like.'},
  {pose: 'longPress', text: 'Hold to see options.'},
];

export function TeachingArtworkPreviewScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [replay, setReplay] = useState(0);
  return <View style={[styles.page, {paddingTop: insets.top}]}>
    <StatusBar barStyle="light-content" backgroundColor="#100F0D"/>
    <View style={styles.header}>
      <Text style={styles.heading} accessibilityRole="header">Teaching artwork</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Close artwork preview" onPress={() => navigation.goBack()} style={styles.close}><Ionicons name="close" size={25} color="#F6E7D6"/></Pressable>
    </View>
    <FlatList data={teachingArtworkCatalog} keyExtractor={item => item.name} numColumns={2}
      showsVerticalScrollIndicator={false} initialNumToRender={6} maxToRenderPerBatch={6} windowSize={3}
      contentContainerStyle={{paddingHorizontal: 16, paddingBottom: insets.bottom + 20}}
      ListHeaderComponent={<View style={styles.intro}>
        <Text style={styles.note}>13 illustrations and four gesture tips.</Text>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Gesture tips</Text><Pressable accessibilityRole="button" onPress={() => setReplay(value => value + 1)} style={styles.replay}><Text style={styles.replayText}>Replay</Text></Pressable></View>
        {poses.map(item => <GestureTeachingHand key={item.pose} pose={item.pose} text={item.text} replayKey={replay} size={64}/>)}
        <Text style={styles.note}>Each gesture plays twice. Reduce Motion keeps the hand and text still.</Text>
        <Text style={styles.sectionTitle}>Illustrations</Text>
      </View>}
      renderItem={({item}) => <View style={styles.artItem}>
        <TeachingArt name={item.name} size={142} label={item.title}/>
        <Text style={styles.artTitle}>{item.title}</Text><Text style={styles.artGroup}>{item.group}</Text>
      </View>}/>
  </View>;
}

const styles = StyleSheet.create({
  page: {flex: 1, backgroundColor: '#100F0D'},
  header: {paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  heading: {fontFamily: 'DMSans_700Bold', color: '#F6E7D6', fontSize: 20},
  close: {width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#29252B'},
  intro: {gap: 12, paddingBottom: 24},
  note: {fontFamily: 'DMSans_400Regular', color: '#BDB3BD', fontSize: 12, lineHeight: 18},
  sectionHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  sectionTitle: {fontFamily: 'DMSans_700Bold', color: '#F6E7D6', fontSize: 16, marginTop: 8},
  replay: {minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center'},
  replayText: {fontFamily: 'DMSans_500Medium', color: '#F2C1BE', fontSize: 13},
  artItem: {flex: 1, alignItems: 'center', paddingVertical: 16, gap: 6},
  artTitle: {fontFamily: 'DMSans_500Medium', color: '#F6E7D6', fontSize: 12, textAlign: 'center'},
  artGroup: {fontFamily: 'DMSans_400Regular', color: '#BDB3BD', fontSize: 11},
});
