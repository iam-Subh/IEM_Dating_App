import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system/legacy';
import type { Layer, MediaSource, StoryDraftItem } from './composition/types';
import { loadStorySource, storyStill } from '../storySources';
import { CENTER } from './composition/types';
import { localId, newStoryItem } from './composition/story';
import { loadDraft } from './drafts/draftStore';
import { STORY_BACKGROUNDS } from './fonts';
import { dispatchStoryBack } from './backStack';
import { StoryCamera, gradientPhoto } from './camera/StoryCamera';
import { StoryEditor } from './editor/StoryEditor';
import { StoryShareSheetScreen } from './editor/StoryShareSheet';
import { importPhoto, importVideo } from './import';

type Stage =
  | { kind: 'camera' }
  | { kind: 'loading' }
  | { kind: 'editor'; items: StoryDraftItem[]; draftId: string | null; openText?: boolean; openMusic?: boolean; key: number };

export type ReplyCard = { prompt: string; text: string };
/** Joining an Add Yours: the story starts with the thread's sticker. */
export type AddYoursPreset = { threadId?: string; prompt: string; music: boolean };
/** Adding a story you were mentioned in to your own. */
export type ResharePreset = { storyId: string; ownerName: string };
/** Sharing your own archived Story again (STORY_ARCHIVE_SPEC.md, section 9.2). */
export type ShareAgainPreset = { storyId: string; publishedAt: string };

type StoryCreatorProps = {
  demo?: boolean;
  onClose: () => void;
  replyCard?: ReplyCard | null;
  addYours?: AddYoursPreset | null;
  reshare?: ResharePreset | null;
  shareAgain?: ShareAgainPreset | null;
};
const CreatorStack = createNativeStackNavigator();
const CreatorProps = createContext<StoryCreatorProps | null>(null);

/** Keep the native sheet in the creator's window, including the demo Modal. */
export function StoryCreator(props: StoryCreatorProps) {
  return (
    <CreatorProps.Provider value={props}>
      <CreatorStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' }, gestureEnabled: false }}>
        <CreatorStack.Screen name="StoryComposer" component={StoryCreatorContent} />
        <CreatorStack.Screen name="StoryShareOptions" component={StoryShareSheetScreen} options={{
          presentation: 'formSheet', sheetAllowedDetents: 'fitToContents', sheetInitialDetentIndex: 0,
          sheetGrabberVisible: true, sheetCornerRadius: 28, sheetShouldOverflowTopInset: false,
          gestureEnabled: true, contentStyle: { backgroundColor: '#262628' },
        }} />
      </CreatorStack.Navigator>
    </CreatorProps.Provider>
  );
}

/** The camera and editor retain their state while the native sheet is open. */
function StoryCreatorContent() {
  const props = useContext(CreatorProps);
  if (!props) throw new Error('Story creator is missing its configuration.');
  const { demo, onClose, replyCard, addYours, reshare, shareAgain } = props;
  const [stage, setStage] = useState<Stage>(replyCard || reshare || shareAgain ? { kind: 'loading' } : { kind: 'camera' });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const navigation = useNavigation();

  // On a navigation screen, back reaches BackHandler; in the demo's Modal,
  // StoryTray forwards onRequestClose to the same stack.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // A screen opened over the creator (the Close Friends list) handles its own back.
      if (!navigation.isFocused()) return false;
      if (!dispatchStoryBack()) closeRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!replyCard) return;
    let active = true;
    gradientPhoto(STORY_BACKGROUNDS[2])
      .then((media) => {
        if (!active) return;
        const item = newStoryItem({ ...media, locked: true });
        setStage({
          kind: 'editor',
          items: [{ ...item, layers: [{ id: localId('r'), kind: 'replyCard', prompt: replyCard.prompt, text: replyCard.text, transform: { ...CENTER } }] }],
          draftId: null,
          key: Date.now(),
        });
      })
      .catch(() => { if (active) setStage({ kind: 'camera' }); });
    return () => { active = false; };
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resharing: the mentioning story's picture on a coloured background, with who posted it.
  useEffect(() => {
    if (!reshare) return;
    let active = true;
    (async () => {
      const source = await loadStorySource(reshare.storyId);
      const still = storyStill(source);
      if (!still || source.locked) throw new Error('This story cannot be shared');
      const local = `${FileSystem.cacheDirectory}story-reshare-${Date.now()}.jpg`;
      await FileSystem.downloadAsync(still, local);
      const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        Image.getSize(local, (width, height) => resolve({ width, height }), reject);
      });
      const background = await gradientPhoto(STORY_BACKGROUNDS[1]);
      const longest = Math.max(size.width, size.height);
      const layers: Layer[] = [
        { id: localId('p'), kind: 'photo', uri: local, width: (size.width / longest) * 760, height: (size.height / longest) * 760, shape: 'rounded', transform: { ...CENTER, y: 880 } },
        { id: localId('t'), kind: 'text', text: `@${reshare.ownerName}`, font: 'classic', color: '#FFFFFF', background: 'translucent', align: 'center', size: 56, transform: { ...CENTER, y: 1420 } },
      ];
      if (active) setStage({ kind: 'editor', items: [{ ...newStoryItem(background), layers }], draftId: null, key: Date.now() });
    })().catch(() => {
      if (!active) return;
      Alert.alert('Story unavailable', 'This story can no longer be added to yours.');
      onClose();
    });
    return () => { active = false; };
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Share again (section 9.2): the archived Story's own media as the full
  // background - not a small card, as resharing a mention is - with a
  // removable date sticker and no other interactive stickers carried over.
  useEffect(() => {
    if (!shareAgain) return;
    let active = true;
    (async () => {
      const source = await loadStorySource(shareAgain.storyId);
      if (!source.url || source.locked) throw new Error('This story cannot be shared again');
      const isVideo = source.contentType.startsWith('video/');
      const ext = isVideo ? 'mp4' : (source.contentType.includes('png') ? 'png' : 'jpg');
      const local = `${FileSystem.cacheDirectory}story-share-again-${Date.now()}.${ext}`;
      await FileSystem.downloadAsync(source.url, local);
      const media = isVideo ? await importVideo(local) : await importPhoto(local, true);
      const date = new Date(shareAgain.publishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const layers: Layer[] = [
        { id: localId('t'), kind: 'text', text: date, font: 'classic', color: '#FFFFFF', background: 'translucent', align: 'center', size: 40, transform: { ...CENTER, y: 300 } },
      ];
      if (active) setStage({ kind: 'editor', items: [{ ...newStoryItem(media), layers }], draftId: null, key: Date.now() });
    })().catch(() => {
      if (!active) return;
      Alert.alert('Story unavailable', 'This story can no longer be shared again.');
      onClose();
    });
    return () => { active = false; };
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openEditor = (media: MediaSource[], options?: { openText?: boolean; filterId?: string }) => {
    // A filter chosen on the camera carries into the editor.
    const items = media.map((entry) => ({ ...newStoryItem(entry), ...(options?.filterId ? { filterId: options.filterId } : {}) }));
    if (addYours && items[0]) {
      const id = localId('s');
      items[0] = {
        ...items[0],
        layers: [...items[0].layers, {
          id,
          kind: 'sticker',
          sticker: { id, type: 'addYours', prompt: addYours.prompt, threadId: addYours.threadId, music: addYours.music || undefined, style: 'default', transform: { ...CENTER, y: 1250 } },
        }],
      };
    }
    setStage({ kind: 'editor', items, draftId: null, openText: options?.openText, openMusic: !!addYours?.music, key: Date.now() });
  };

  const openDraft = async (draftId: string) => {
    const items = await loadDraft(draftId);
    if (!items?.length) {
      Alert.alert('Draft unavailable', 'This draft could not be opened.');
      return;
    }
    setStage({ kind: 'editor', items, draftId, key: Date.now() });
  };

  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="light" />
      {stage.kind === 'loading' ? (
        <View style={[styles.root, styles.center]}><ActivityIndicator color="#fff" /></View>
      ) : stage.kind === 'camera' ? (
        <StoryCamera active onCaptured={openEditor} onOpenDraft={(id) => void openDraft(id)} onClose={onClose} />
      ) : (
        <StoryEditor
          key={stage.key}
          initialItems={stage.items}
          draftId={stage.draftId}
          demo={demo}
          openText={stage.openText}
          openMusic={stage.openMusic}
          onBack={() => (replyCard || reshare || shareAgain ? onClose() : setStage({ kind: 'camera' }))}
          onFinished={onClose}
        />
      )}
    </GestureHandlerRootView>
  );
}

/** The navigation screen for real stories. */
export function StoryCreatorScreen({ navigation, route }: any) {
  return (
    <StoryCreator
      replyCard={route?.params?.replyCard ?? null}
      addYours={route?.params?.addYours ?? null}
      reshare={route?.params?.reshare ?? null}
      shareAgain={route?.params?.shareAgain ?? null}
      onClose={() => navigation.goBack()}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
