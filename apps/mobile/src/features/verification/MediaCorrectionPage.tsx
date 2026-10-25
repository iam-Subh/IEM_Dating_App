import React, {useState} from 'react';
import {Image, ScrollView, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Rect, Path, Circle, G} from 'react-native-svg';
import {TapChoice, connectionColors as c} from '../auth/onboarding/ConnectionDesign';
import {mediaCorrections, type CheckedMedia, type MediaCorrection} from './mediaCorrectionModel';

function CorrectionArt() {
  return <Svg width={86} height={94} viewBox="0 0 96 106" accessible={false}>
    <Rect x={14} y={17} width={59} height={76} rx={13} fill="#EEDDE3" transform="rotate(-10 44 55)"/>
    <Rect x={23} y={9} width={59} height={76} rx={13} fill="#FFF" stroke="#D8BEC9" strokeWidth={1.5}/>
    <Rect x={31} y={17} width={43} height={52} rx={9} fill="#F2E6E9"/>
    <Circle cx={52} cy={34} r={9} fill="#C98CA7"/>
    <Path d="M37 61V57Q38 46 52 46Q67 46 68 57V61Z" fill="#9D5374"/>
    <Path d="M41 76H64" stroke="#D6BDCA" strokeWidth={3} strokeLinecap="round"/>
    <Circle cx={73} cy={79} r={17} fill="#712C48" stroke="#F2F3EE" strokeWidth={3}/>
    <G transform="translate(73 79) rotate(45)">
      <Path d="M-3 -6Q-3 -8 -1 -8H1Q3 -8 3 -6V4L0 8L-3 4Z" fill="none" stroke="#FFF" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"/>
      <Path d="M-3 -4H3M-3 4H3" fill="none" stroke="#FFF" strokeWidth={1.7} strokeLinecap="round"/>
    </G>
  </Svg>;
}

export function MediaCorrectionPage({items, reason, onEdit, onClose}: {
  items: CheckedMedia[]; reason: string | null; onEdit: (item?: MediaCorrection) => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const {height} = useWindowDimensions();
  const compact = height < 740;
  const {corrections, confirmed, pending} = mediaCorrections(items, reason);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = corrections[activeIndex] ?? corrections[0];
  const action = active?.action ?? 'Update media';
  return <View style={s.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <View style={[s.nav, {paddingTop: insets.top + 8}]}>
      <Text style={s.navTitle}>Face check</Text>
      <TapChoice accessibilityRole="button" accessibilityLabel="Close media correction" onPress={onClose}
        style={({pressed}) => [s.close, pressed && s.pressed]}><Ionicons name="close" size={21} color={c.text}/></TapChoice>
    </View>
    <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, compact && s.compactContent]}>
      <View style={s.hero}>
        <View style={s.headingCopy}>
          <View style={s.status}><View style={s.dot}/><Text style={s.statusText}>{corrections.length ? `${corrections.length} ${corrections.length === 1 ? 'ITEM' : 'ITEMS'} TO UPDATE` : 'MEDIA UPDATE NEEDED'}</Text></View>
          <Text accessibilityRole="header" style={[s.title, compact && s.compactTitle]}>{'Update your\nprofile media.'}</Text>
        </View>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><CorrectionArt/></View>
      </View>
      <Text style={s.description}>{confirmed ? 'Keep the items that passed. Update the items below so we can check them again.' : 'Update the items below so we can match them to your live selfie.'}</Text>
      <View style={s.cards}>
        {corrections.map((item, index) => index !== activeIndex ? <TapChoice key={`${item.kind}:${item.url}:${index}`}
          accessibilityRole="button" accessibilityLabel={`View correction: ${item.name}`} accessibilityState={{expanded: false}}
          onPress={() => setActiveIndex(index)} style={({pressed}) => [s.collapsed, pressed && s.pressed]}>
          {item.kind === 'photo' && item.url ? <Image source={{uri: item.url}} resizeMode="cover" style={s.smallThumb}/>
            : <View style={[s.smallThumb, s.videoThumb]}><Ionicons name={item.kind === 'video' ? 'play' : 'person-outline'} size={18} color={c.primary}/></View>}
          <View style={s.cardCopy}><Text style={s.cardTitle}>{item.name}</Text><Text style={s.collapsedReason}>Needs an update</Text></View>
          <View style={s.expand}><Ionicons name="chevron-down" size={18} color={c.primary}/></View>
        </TapChoice> : <View key={`${item.kind}:${item.url}:${index}`} style={s.card}>
          <View style={s.cardBody}>
            {item.kind === 'photo' && item.url ? <Image source={{uri: item.url}} resizeMode="cover" style={s.thumb}/>
              : <View style={[s.thumb, item.kind === 'video' ? s.videoThumb : s.emptyThumb]}><Ionicons name={item.kind === 'video' ? 'play' : 'person-outline'} size={28} color={c.primary}/>{item.kind === 'video' && <Text style={s.videoLabel}>VIDEO</Text>}</View>}
            <View style={s.cardCopy}>
              <Text style={s.cardTitle}>{item.name}</Text>
              <View style={s.reasonRow}><Ionicons name="alert-circle-outline" size={15} color="#AF3E4E"/><Text style={s.reason}>{item.reason}</Text></View>
              <Text style={s.hint}>{item.hint}</Text>
            </View>
          </View>
          <TapChoice accessibilityRole="button" accessibilityLabel={`${item.action}: ${item.name}`} onPress={() => onEdit(item)}
            style={({pressed}) => [s.cardAction, pressed && s.pressed]}><Ionicons name={item.kind === 'video' ? 'videocam-outline' : 'image-outline'} size={17} color={c.primary}/><Text style={s.cardActionText}>{item.action}</Text><Ionicons name="arrow-forward" size={17} color={c.primary}/></TapChoice>
        </View>)}
      </View>
      {!corrections.length && <View style={s.fallback}><Text style={s.hint}>Open your profile media to add or replace the item that needs correction.</Text></View>}
      {(confirmed > 0 || pending > 0) && <View style={s.summary}>
        {confirmed > 0 && <View style={s.summaryRow}><Ionicons name="checkmark-circle-outline" size={18} color="#39785D"/><Text style={s.summaryText}>{confirmed} {confirmed === 1 ? 'item passed' : 'items passed'} · No changes needed</Text></View>}
        {pending > 0 && <View style={s.summaryRow}><Ionicons name="time-outline" size={18} color="#996B2D"/><Text style={s.summaryText}>{pending} {pending === 1 ? 'item is' : 'items are'} under review</Text></View>}
      </View>}
      <View style={s.help}><Ionicons name="scan-outline" size={18} color={c.muted}/><Text style={s.helpText}>Show your face clearly. Avoid filters that change your features.</Text></View>
    </ScrollView>
    <View style={[s.footer, {paddingBottom: Math.max(insets.bottom, 12) + 8}]}>
      <TapChoice accessibilityRole="button" accessibilityLabel={action} onPress={() => onEdit(active)}
        style={({pressed}) => [s.primary, pressed && s.pressed]}><Text style={s.primaryText}>{action}</Text><Ionicons name="arrow-forward" size={19} color="#FFF"/></TapChoice>
      <Text style={s.footerNote}>Your live selfie stays private.</Text>
    </View>
  </View>;
}

const s = StyleSheet.create({
  page: {flex: 1, backgroundColor: c.canvas}, scroll: {flex: 1},
  nav: {paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  navTitle: {fontFamily: 'DMSans_500Medium', fontSize: 14, color: c.text},
  close: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  pressed: {opacity: 0.6},
  content: {paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16, width: '100%', maxWidth: 500, alignSelf: 'center'},
  compactContent: {paddingTop: 14},
  hero: {flexDirection: 'row', alignItems: 'center', gap: 6}, headingCopy: {flex: 1},
  status: {alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5},
  dot: {width: 5, height: 5, borderRadius: 3, backgroundColor: '#AF3E4E'},
  statusText: {fontFamily: 'DMSans_700Bold', fontSize: 9, lineHeight: 15, letterSpacing: 0.5, color: '#AF3E4E'},
  title: {fontFamily: 'CormorantGaramond_600SemiBold', fontSize: 35, lineHeight: 41, paddingTop: 8, paddingBottom: 6, includeFontPadding: true, color: c.text},
  compactTitle: {fontSize: 31, lineHeight: 37},
  description: {fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 21, color: c.muted, marginTop: 8},
  cards: {gap: 12, marginTop: 20}, card: {backgroundColor: '#FFF', borderRadius: 22, padding: 14},
  collapsed: {minHeight: 72, backgroundColor: '#FFF', borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 13},
  smallThumb: {width: 40, height: 52, borderRadius: 9, backgroundColor: '#EEDDE3'},
  collapsedReason: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: '#AF3E4E', marginTop: 2},
  expand: {width: 32, height: 32, borderRadius: 16, backgroundColor: '#F4EAF0', alignItems: 'center', justifyContent: 'center'},
  cardBody: {flexDirection: 'row', gap: 13, alignItems: 'flex-start'},
  thumb: {width: 72, height: 94, borderRadius: 13, backgroundColor: '#EEDDE3'},
  videoThumb: {backgroundColor: '#E3D9EE', alignItems: 'center', justifyContent: 'center', gap: 8},
  emptyThumb: {alignItems: 'center', justifyContent: 'center'},
  videoLabel: {fontFamily: 'DMSans_700Bold', fontSize: 9, letterSpacing: 1, color: c.primary},
  cardCopy: {flex: 1}, cardTitle: {fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 23, color: c.text},
  reasonRow: {flexDirection: 'row', gap: 5, marginTop: 5, alignItems: 'flex-start'},
  reason: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 17, color: '#AF3E4E'},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted, marginTop: 6},
  cardAction: {minHeight: 44, marginTop: 12, borderRadius: 22, paddingHorizontal: 14, backgroundColor: '#F4EAF0', flexDirection: 'row', alignItems: 'center', gap: 8},
  cardActionText: {flex: 1, fontFamily: 'DMSans_500Medium', fontSize: 13, lineHeight: 20, color: c.primary},
  summary: {gap: 8, marginTop: 18}, summaryRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  summaryText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted},
  help: {flexDirection: 'row', gap: 9, marginTop: 18, alignItems: 'flex-start'},
  helpText: {flex: 1, fontFamily: 'DMSans_400Regular', fontSize: 12, lineHeight: 18, color: c.muted},
  fallback: {padding: 16, backgroundColor: '#FFF', borderRadius: 18},
  footer: {paddingTop: 12, paddingHorizontal: 24, width: '100%', maxWidth: 500, alignSelf: 'center'},
  primary: {minHeight: 52, borderRadius: 26, backgroundColor: c.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10},
  primaryText: {fontFamily: 'DMSans_500Medium', fontSize: 16, lineHeight: 23, color: '#FFF'},
  footerNote: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 15, color: c.muted, textAlign: 'center', marginTop: 9},
});
