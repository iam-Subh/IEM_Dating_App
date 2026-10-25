import React, {useEffect, useRef, useState} from 'react';
import {Image, StatusBar, StyleSheet, Text, View, useWindowDimensions} from 'react-native';
import {CommonActions, useNavigation, useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import {VideoPoster, useVideoPoster} from './VideoPoster';
import {rememberPreviewPhoto} from './photoPreviewCache';
import Svg, {G, Path, Rect} from 'react-native-svg';
import {ConnectionFooter, ConnectionNav, ConnectionSheetHeader, TapChoice, connectionColors as c, connectionStyles as shared} from './ConnectionDesign';

type Props = {
  photos: (string | null)[]; videoUri: string | null; busy: boolean;
  error: string; status: string; progress: number | null; label: string;
  onBack: () => void; onNext: () => void; onPhoto: (index: number) => void; onPhotoOptions: (index: number) => void;
  onVideo: () => void; onPlay: () => void;
};

function Check({ready}: {ready: boolean}) {
  return <View style={[s.requirementCheck, ready && {backgroundColor: c.primary}]}>{ready && <Svg width={12} height={12} viewBox="0 0 24 24"><Path d="M5 12L10 17L19 7" stroke="#FFF" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none"/></Svg>}</View>;
}

function VideoThumbnail({uri, onPlay}: {uri: string; onPlay: () => void}) {
  const poster = useVideoPoster(uri);
  const duration = poster?.duration ?? 0;
  return <TapChoice onPress={onPlay} accessibilityRole="button" accessibilityLabel="Play profile video" style={s.thumbnail}>
    <VideoPoster uri={poster?.uri ?? ''}/>
    <View style={s.play}><Ionicons name="play" size={17} color="#FFF"/></View>
    {duration > 0 && <Text style={s.duration}>{`${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`}</Text>}
  </TapChoice>;
}

function VideoArt() {
  return <Svg width={82} height={92} viewBox="0 0 80 80" accessible={false}>
    <G transform="rotate(-7 35.5 38)">
      <Rect x="12" y="20" width="53" height="46" rx="12" fill="#C496AC"/>
      <Rect x="9" y="15" width="53" height="46" rx="12" fill="#FFF8FA" stroke="#B37994" strokeWidth="1.5"/>
      <Path d="M30 27L46.5 38L30 49Z" fill="#99516F" stroke="#99516F" strokeLinejoin="round" strokeWidth="3"/>
    </G>
    <Path d="M54 54C48 45 40 52 44 58L54 66L64 58C68 52 60 45 54 54Z" fill="#DF96AA"/>
  </Svg>;
}

export function PhotoIntroduction(p: Props) {
  const {height} = useWindowDimensions();
  const compact = height < 740;
  const [gallerySize, setGallerySize] = useState({width: 0, height: 0});
  const tileSize = Math.max(0, Math.min((gallerySize.width - 20) / 3, (gallerySize.height - 10) / 2));
  const count = p.photos.filter(Boolean).length;
  const tile = (index: number) => <View key={index} style={[s.tile, {width: tileSize, height: tileSize}, index === 0 && s.mainTile]}>
    <TapChoice onPress={() => p.onPhoto(index)} disabled={p.busy} accessibilityRole="button" accessibilityLabel={`${p.photos[index] ? 'View' : 'Add'} ${index === 0 ? 'main photo' : `photo ${index + 1}`}`} style={({pressed}) => [StyleSheet.absoluteFill, pressed && shared.pressed]}>
    {p.photos[index] ? <Image source={{uri: p.photos[index]!}} onLoad={event => rememberPreviewPhoto(p.photos[index]!, event.nativeEvent.source)} style={StyleSheet.absoluteFill} resizeMode="cover"/> : index === 0 ? <View style={s.emptyMain}>
      <Image source={require('../../../../assets/illustrations/profile-camera-3d.png')} resizeMode="contain" style={s.camera}/>
      <Text style={s.mainLabel}>Add photo</Text>
    </View> : <View style={s.emptySmall}><Ionicons name="add" size={24} color="#A16D83"/><Text style={s.slotNumber}>{String(index + 1).padStart(2, '0')}</Text></View>}
    </TapChoice>
    {index === 0 && !!p.photos[index] && <View pointerEvents="none" style={s.mainBadge}><Text style={s.mainBadgeText}>Main</Text></View>}
    {!!p.photos[index] && <TapChoice accessibilityRole="button" accessibilityLabel={`${index === 0 ? 'Main photo' : `Photo ${index + 1}`} options`} disabled={p.busy} onPress={() => p.onPhotoOptions(index)} style={({pressed}) => [s.editTouch, pressed && shared.pressed]}><View style={s.editBadge}><Ionicons name="ellipsis-horizontal" size={16} color={c.primary}/></View></TapChoice>}
  </View>;
  return <View style={shared.page}>
    <StatusBar barStyle="dark-content" backgroundColor={c.canvas}/>
    <ConnectionNav stage={4} busy={p.busy} onBack={p.onBack}/>
    <View style={[s.content, compact && {paddingTop: 10}]}>
      <Text accessibilityRole="header" style={[shared.title, s.title, compact && {fontSize: 34, lineHeight: 36}]}>{'Make it look\nlike you.'}</Text>
      <Text style={shared.subtitle}>Let people see you and hear your voice.</Text>
      <View style={[s.videoCard, compact && {marginTop: 12, paddingVertical: 10}]}>
        {p.videoUri ? <VideoThumbnail key={p.videoUri} uri={p.videoUri} onPlay={p.onPlay}/> : <TapChoice disabled={p.busy} onPress={p.onVideo} accessibilityRole="button" accessibilityLabel="Choose a profile video" style={s.videoArt}><VideoArt/></TapChoice>}
        <View style={{flex: 1}}>
          <View style={s.requiredBadge}><Text style={s.requiredText}>{p.videoUri ? 'Video added' : 'Required'}</Text></View>
          <Text style={s.videoTitle}>{p.videoUri ? 'Your introduction' : 'Introduce yourself'}</Text>
          <Text style={s.detail}>15–60 seconds · Public profile</Text>
          <TapChoice disabled={p.busy} accessibilityRole="button" accessibilityLabel={p.videoUri ? 'Edit profile video' : 'Add profile video'} onPress={p.onVideo} style={({pressed}) => [s.videoAction, pressed && shared.pressed]}>
            <Ionicons name={p.videoUri ? 'pencil-outline' : 'videocam-outline'} size={17} color="#FFF"/><Text style={s.videoActionText}>{p.videoUri ? 'Edit video' : 'Add video'}</Text>
          </TapChoice>
        </View>
      </View>
      <View style={s.sectionRow}><Text style={s.section}>Your photos</Text><Text accessibilityLiveRegion="polite" style={s.count}>{count}/6 photos</Text></View>
      <View style={s.gallery} onLayout={event => {
        const {width, height} = event.nativeEvent.layout;
        setGallerySize(current => current.width === width && current.height === height ? current : {width, height});
      }}>
        <View style={s.topRow}>{[0, 1, 2].map(tile)}</View>
        <View style={s.bottomRow}>{[3, 4, 5].map(tile)}</View>
      </View>
      <View style={s.hintRow}>
        <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[s.hint, p.busy && s.uploadText]}>{p.busy ? p.status : 'Your main photo appears first on your profile.'}</Text>
        {p.busy && p.progress !== null && <View accessibilityRole="progressbar" accessibilityValue={{min: 0, max: 100, now: Math.round(p.progress * 100)}} style={s.track}><View style={[s.fill, {width: `${Math.round(p.progress * 100)}%`}]}/></View>}
      </View>
      <View style={s.privacy}><Ionicons name="shield-checkmark-outline" size={15} color={c.muted}/><Text style={s.privacyText}>Face verification is a separate, private step.</Text></View>
    </View>
    <View style={s.requirements} accessibilityLiveRegion="polite"><View style={s.requirement}><Check ready={count > 0}/><Text style={s.detail}>1 photo</Text></View><View style={s.requirement}><Check ready={!!p.videoUri}/><Text style={s.detail}>1 profile video</Text></View></View>
    <ConnectionFooter label={p.label} busy={p.busy} disabled={!p.videoUri || count === 0} error={p.error} onNext={p.onNext}/>
  </View>;
}

export type PhotoMediaAction = 'crop' | 'preview' | 'replace' | 'main' | 'remove' | 'camera' | 'library';
export function PhotoMediaSheet() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const video = route.params?.kind === 'video';
  const hasMedia = !!route.params?.hasMedia;
  const main = !video && route.params?.index === 0;
  const chosen = useRef(false);
  const choose = (action: PhotoMediaAction) => {
    if (chosen.current) return;
    chosen.current = true;
    navigation.dispatch({...CommonActions.setParams({photoMediaAction: {action, kind: route.params?.kind, index: route.params?.index, revision: Date.now()}}), source: route.params?.returnKey});
    navigation.goBack();
  };
  const options: {label: string; note: string; icon: keyof typeof Ionicons.glyphMap; action: PhotoMediaAction}[] = video ? [
    ...(hasMedia ? [{label: 'Preview video', note: 'Watch your introduction', icon: 'play-outline' as const, action: 'preview' as const}] : []),
    {label: hasMedia ? 'Record a new video' : 'Record video', note: 'Introduce yourself in 15–60 seconds', icon: 'videocam-outline', action: 'camera'},
    {label: 'Choose from library', note: 'Use a video from your device', icon: 'images-outline', action: 'library'},
    ...(hasMedia ? [{label: 'Remove video', note: '', icon: 'trash-outline' as const, action: 'remove' as const}] : []),
  ] : [
    {label: 'Crop photo', note: 'Adjust the frame, rotate or flip', icon: 'crop-outline', action: 'crop'},
    {label: 'Replace photo', note: 'Choose a different photo', icon: 'images-outline', action: 'replace'},
    ...(!main ? [{label: 'Make main photo', note: 'Show this photo first on your profile', icon: 'person-circle-outline' as const, action: 'main' as const}] : []),
    {label: 'Remove photo', note: '', icon: 'trash-outline', action: 'remove'},
  ];
  return <View style={[s.sheet, {paddingBottom: Math.max(insets.bottom, 16) + 16}]}>
    <ConnectionSheetHeader title={video ? (hasMedia ? 'Your introduction' : 'Add your video') : main ? 'Your main photo' : 'Your photo'} onClose={() => navigation.goBack()} style={{marginBottom: 14}}/>
    {!video && route.params?.photoUri && <View style={s.selectedMedia}><Image source={{uri: route.params.photoUri}} style={s.selectedPhoto}/><View style={{flex: 1}}><Text style={s.selectedTitle}>{main ? 'First on your profile' : `Photo ${route.params.index + 1}`}</Text><Text style={s.optionNote}>Crop it or choose a different photo.</Text></View><View style={s.selectedBadge}><Ionicons name={main ? 'person-outline' : 'image-outline'} size={18} color={c.primary}/></View></View>}
    {options.map(item => <TapChoice key={item.action} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => choose(item.action)} style={({pressed}) => [s.sheetOption, item.action === 'remove' && s.removeOption, pressed && shared.pressed]}>
      <View style={[s.optionIcon, item.action === 'remove' && {backgroundColor: '#F5E1E3'}]}><Ionicons name={item.icon} size={21} color={item.action === 'remove' ? '#AE2646' : c.primary}/></View>
      <View style={{flex: 1}}><Text style={[s.optionText, item.action === 'remove' && {color: '#AE2646'}]}>{item.label}</Text>{!!item.note && <Text style={s.optionNote}>{item.note}</Text>}</View>
      {item.action !== 'remove' && <Ionicons name="chevron-forward" size={17} color="#A08D97"/>}
    </TapChoice>)}
  </View>;
}

const s = StyleSheet.create({
  content: {flex: 1, maxWidth: 500, width: '100%', alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18},
  title: {fontSize: 38, lineHeight: 40, paddingBottom: 6},
  sectionRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 10},
  section: {fontFamily: 'DMSans_700Bold', fontSize: 14, lineHeight: 20, color: c.text},
  count: {fontFamily: 'DMSans_500Medium', fontSize: 12, color: c.muted},
  gallery: {flex: 1, minHeight: 0, maxHeight: 350, gap: 10, alignItems: 'center', justifyContent: 'center'},
  topRow: {flexDirection: 'row', gap: 10},
  bottomRow: {flexDirection: 'row', gap: 10},
  tile: {borderRadius: 19, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E0D7D9', overflow: 'hidden'},
  mainTile: {backgroundColor: '#EEDDE3', borderColor: '#D5B9C5'},
  emptyMain: {flex: 1, justifyContent: 'center', alignItems: 'center', padding: 8},
  camera: {width: '72%', height: '49%', maxHeight: 126, marginBottom: 6},
  mainLabel: {fontFamily: 'DMSans_700Bold', fontSize: 12, lineHeight: 18, color: c.primary},
  emptySmall: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  slotNumber: {position: 'absolute', left: 10, bottom: 8, fontFamily: 'DMSans_500Medium', fontSize: 10, color: '#A18C96'},
  mainBadge: {position: 'absolute', left: 10, top: 10, backgroundColor: '#FFF4F8', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4},
  mainBadgeText: {fontFamily: 'DMSans_700Bold', fontSize: 10, color: c.primary},
  editTouch: {position: 'absolute', right: 0, bottom: 0, width: 44, height: 44, justifyContent: 'center', alignItems: 'center'},
  editBadge: {width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center'},
  hintRow: {height: 16, marginTop: 7},
  hint: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 16, color: c.muted},
  uploadText: {color: c.primary, textAlign: 'center'},
  videoCard: {flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#EEDDE3', borderWidth: 1, borderColor: '#D7B6C5', borderRadius: 24, padding: 14, marginTop: 18},
  videoArt: {width: 82, height: 100, justifyContent: 'center', alignItems: 'center'},
  videoTitle: {fontFamily: 'DMSans_700Bold', fontSize: 16, lineHeight: 23, color: c.text, marginTop: 5},
  requiredBadge: {alignSelf: 'flex-start', backgroundColor: '#FFF5F8', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2},
  requiredText: {fontFamily: 'DMSans_700Bold', fontSize: 10, lineHeight: 16, color: c.primary},
  videoAction: {alignSelf: 'flex-start', flexDirection: 'row', gap: 7, paddingHorizontal: 14, minHeight: 40, borderRadius: 20, marginTop: 9, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center'},
  videoActionText: {fontFamily: 'DMSans_700Bold', fontSize: 12, color: '#FFF'},
  detail: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 18, color: c.muted},
  thumbnail: {width: 82, height: 106, borderRadius: 16, overflow: 'hidden', backgroundColor: '#493447', alignItems: 'center', justifyContent: 'center'},
  play: {width: 30, height: 30, borderRadius: 15, backgroundColor: '#352335A0', justifyContent: 'center', alignItems: 'center'},
  duration: {position: 'absolute', right: 4, bottom: 3, backgroundColor: '#352335A0', color: '#FFF', fontSize: 9, paddingHorizontal: 3, borderRadius: 3},
  privacy: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10},
  privacyText: {fontFamily: 'DMSans_400Regular', fontSize: 10, lineHeight: 16, color: c.muted, flexShrink: 1},
  requirements: {flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 12},
  requirement: {flexDirection: 'row', alignItems: 'center', gap: 6},
  requirementCheck: {width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: '#AA8B9A', alignItems: 'center', justifyContent: 'center'},
  track: {position: 'absolute', bottom: -6, alignSelf: 'center', width: '100%', maxWidth: 300, height: 3, borderRadius: 2, backgroundColor: '#E0D2D8', overflow: 'hidden'},
  fill: {height: 3, backgroundColor: c.primary},
  sheet: {backgroundColor: c.canvas, padding: 24},
  sheetOption: {flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 19, backgroundColor: '#FFF', marginTop: 8, minHeight: 64},
  removeOption: {backgroundColor: '#FFF1F3', borderWidth: 1, borderColor: '#EBCBD2', marginTop: 8, minHeight: 64},
  optionIcon: {width: 40, height: 40, borderRadius: 14, backgroundColor: c.wash, alignItems: 'center', justifyContent: 'center'},
  optionText: {fontFamily: 'DMSans_500Medium', fontSize: 14, lineHeight: 21, color: c.text},
  optionNote: {fontFamily: 'DMSans_400Regular', fontSize: 11, lineHeight: 17, color: c.muted, marginTop: 2},
  selectedMedia: {flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 10},
  selectedPhoto: {width: 54, height: 54, borderRadius: 14, backgroundColor: c.wash},
  selectedTitle: {fontFamily: 'DMSans_700Bold', fontSize: 13, lineHeight: 20, color: c.text},
  selectedBadge: {width: 34, height: 34, borderRadius: 17, backgroundColor: c.wash, alignItems: 'center', justifyContent: 'center'},
});
