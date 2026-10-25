import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Dimensions,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Album, Asset, AssetField, MediaType, Query, addListener, presentPermissionsPicker, requestPermissionsAsync } from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { colors } from '../../../core/theme/colors';
import { MAX_CHAT_ATTACHMENTS, SelectedChatMedia } from './attachmentTypes';
import { attachmentPickerSelection, finishAttachmentPickerRequest } from '../attachmentPickerRequests';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_GAP = 2;
const GRID_COLUMNS = 3;
const CELL_SIZE = (SCREEN_WIDTH - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
const MEDIA_PAGE_SIZE = 80;

/**
 * The loaded gallery, kept for the life of the app rather than the life of the
 * sheet.
 *
 * The picker used to re-query the whole library every time it opened, so every
 * visit began on "Loading recent media" and the grid was rebuilt from nothing -
 * work the device had already done moments earlier. Holding it here means the
 * second open paints the grid it had before, and a refresh becomes something
 * that happens behind an already-usable screen.
 */
type LibraryCache = {
  items: SelectedChatMedia[];
  albums: Array<{ album: Album; title: string }>;
  albumId: string;
  albumTitle: string;
  offset: number;
  hasMore: boolean;
};
let libraryCache: LibraryCache | null = null;

/**
 * Bumped whenever the device's media may have changed since we last looked.
 *
 * Two signals, because neither is sufficient alone. `addListener` reports
 * MediaStore changes, but the interesting case is the user leaving for the
 * camera app and coming back - and an observer in a backgrounded process is not
 * something to rely on. So returning to the foreground counts as a change in
 * its own right, which covers a photo taken while we were not running.
 */
let deviceRevision = 0;
let syncedRevision = -1;
const revisionListeners = new Set<() => void>();

function bumpRevision(): void {
  deviceRevision += 1;
  for (const listener of revisionListeners) listener();
}

// Registered once for the lifetime of the app, deliberately. Binding these to
// the sheet's own mount would miss exactly the event that matters: the app is
// foregrounded before the user reopens the picker, so a listener that starts
// with the sheet starts too late.
let watchingDevice = false;
function watchDeviceLibrary(): void {
  if (watchingDevice) return;
  watchingDevice = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') bumpRevision();
  });
  try {
    addListener(() => bumpRevision());
  } catch {
    // Change events are an optimisation; foregrounding still covers us.
  }
}
watchDeviceLibrary();

type SourceAction = {
  key: 'gallery' | 'camera' | 'file';
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
};

const SOURCE_ACTIONS: SourceAction[] = [
  { key: 'gallery', label: 'Gallery', icon: 'images' },
  { key: 'camera', label: 'Camera', icon: 'camera' },
  { key: 'file', label: 'File', icon: 'document' },
];

function formatDuration(durationMs?: number | null) {
  if (!durationMs) return '';
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function normalizePickerAsset(asset: ImagePicker.ImagePickerAsset): SelectedChatMedia {
  const kind = asset.type === 'video' ? 'video' : 'image';
  return {
    id: asset.assetId ?? `${kind}-${asset.uri}`,
    originalUri: asset.uri,
    currentUri: asset.uri,
    kind,
    fileName: asset.fileName ?? undefined,
    mimeType: asset.mimeType,
    durationMs: asset.duration,
  };
}

function MediaThumbnail({ item, style }: { item: SelectedChatMedia; style: object }) {
  const [thumbnailUri, setThumbnailUri] = useState(item.kind === 'image' ? item.currentUri : undefined);
  useEffect(() => {
    let active = true;
    if (item.kind === 'file') {
      setThumbnailUri(undefined);
      return () => { active = false; };
    }
    if (item.kind === 'image') {
      setThumbnailUri(item.currentUri);
      return () => { active = false; };
    }
    VideoThumbnails.getThumbnailAsync(item.currentUri, { time: 100 })
      .then((result) => { if (active) setThumbnailUri(result.uri); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [item.currentUri, item.kind]);
  if (item.kind === 'file') {
    return <View style={[style, styles.videoPlaceholder]}><Ionicons name="document-text" size={28} color="#fff" /></View>;
  }
  if (!thumbnailUri) return <View style={[style, styles.videoPlaceholder]}><Ionicons name="play" size={25} color="#fff" /></View>;
  return <Image source={{ uri: thumbnailUri }} style={style} resizeMode="cover" />;
}

async function resolveLibraryAsset(asset: Asset): Promise<SelectedChatMedia> {
  const [uri, kind, fileName, durationMs] = await Promise.all([
    asset.getUri(),
    asset.getMediaType(),
    asset.getFilename(),
    asset.getDuration(),
  ]);
  return {
    id: asset.id,
    originalUri: uri,
    currentUri: uri,
    kind: kind === MediaType.VIDEO ? 'video' : 'image',
    fileName,
    mimeType: kind === MediaType.VIDEO ? 'video/mp4' : undefined,
    durationMs,
  };
}

interface Props {
  visible: boolean;
  selected: SelectedChatMedia[];
  onClose: () => void;
  onContinue: (items: SelectedChatMedia[]) => void;
}

export function AttachmentPickerSheet({ visible, selected, onClose, onContinue }: Props) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<SelectedChatMedia[]>(() => libraryCache?.items ?? []);
  // Mirrors `items` so a load can merge against the current list without a
  // functional update - the merge also writes the module cache, and that must
  // not run twice for one render.
  const itemsRef = useRef<SelectedChatMedia[]>(libraryCache?.items ?? []);
  const [selection, setSelection] = useState<SelectedChatMedia[]>(selected);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Kept apart from permissionDenied. A gallery that failed to load is not a
  // gallery the user has blocked, and offering "Allow access" for a MediaStore
  // error sends them to a settings screen where everything is already correct.
  const [loadFailed, setLoadFailed] = useState(false);
  const [limitedAccess, setLimitedAccess] = useState(false);
  const [albums, setAlbums] = useState<Array<{ album: Album; title: string }>>(() => libraryCache?.albums ?? []);
  const [activeAlbumId, setActiveAlbumId] = useState<string>(() => libraryCache?.albumId ?? 'all');
  const [activeAlbumTitle, setActiveAlbumTitle] = useState(() => libraryCache?.albumTitle ?? 'All media');
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const offsetRef = useRef(libraryCache?.offset ?? 0);
  const hasMoreRef = useRef(libraryCache?.hasMore ?? true);
  const loadingPageRef = useRef(false);
  const albumsRef = useRef<Array<{ album: Album; title: string }>>(libraryCache?.albums ?? []);
  const activeAlbumIdRef = useRef(libraryCache?.albumId ?? 'all');

  const selectedIndex = useMemo(
    () => new Map(selection.map((item, index) => [item.id, index + 1])),
    [selection],
  );

  const rememberLibrary = useCallback((albumTitle?: string) => {
    libraryCache = {
      items: itemsRef.current,
      albums: albumsRef.current,
      albumId: activeAlbumIdRef.current,
      albumTitle: albumTitle ?? libraryCache?.albumTitle ?? 'All media',
      offset: offsetRef.current,
      hasMore: hasMoreRef.current,
    };
  }, []);

  /**
   * Album titles, with a dead album unable to take the gallery down with it.
   *
   * MediaStore hands back ids that no longer resolve, and `getTitle()` on one of
   * those rejects. Settling each separately drops just that album.
   */
  const loadAlbums = useCallback(async () => {
    const deviceAlbums = await Album.getAll();
    const albumResults = await Promise.allSettled(
      deviceAlbums.map(async (album) => ({ album, title: await album.getTitle() })),
    );
    return albumResults.flatMap((result) =>
      result.status === 'fulfilled' && result.value.title.trim() ? [result.value] : [],
    );
  }, []);

  const loadMediaPage = useCallback(async (reset: boolean, requestedAlbumId?: string) => {
    if (loadingPageRef.current || (!reset && !hasMoreRef.current)) return;
    loadingPageRef.current = true;
    reset ? setLoading(true) : setLoadingMore(true);
    try {
      const albumId = requestedAlbumId ?? activeAlbumIdRef.current;
      const start = reset ? 0 : offsetRef.current;
      let query = new Query()
        .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .offset(start)
        .limit(MEDIA_PAGE_SIZE);
      const selectedAlbum = albumsRef.current.find((item) => item.album.id === albumId)?.album;
      if (selectedAlbum) query = query.album(selectedAlbum);
      let assets: Asset[];
      try {
        assets = await query.exe();
      } catch (error) {
        // Android can remove or merge a MediaStore album after getAll(). If
        // that happens, keep the picker usable and return to the full library.
        if (albumId === 'all') throw error;
        activeAlbumIdRef.current = 'all';
        setActiveAlbumId('all');
        setActiveAlbumTitle('All media');
        const fallbackQuery = new Query()
          .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
          .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
          .offset(0)
          .limit(MEDIA_PAGE_SIZE);
        assets = await fallbackQuery.exe();
      }
      const resolved = await Promise.all(assets.map(resolveLibraryAsset));
      const known = reset ? new Set<string>() : new Set(itemsRef.current.map((item) => item.id));
      const merged = reset
        ? resolved
        : [...itemsRef.current, ...resolved.filter((item) => !known.has(item.id))];
      itemsRef.current = merged;
      setItems(merged);
      offsetRef.current = (albumId === activeAlbumIdRef.current ? start : 0) + assets.length;
      hasMoreRef.current = assets.length === MEDIA_PAGE_SIZE;
      syncedRevision = deviceRevision;
      rememberLibrary();
    } catch (error) {
      console.error('[AttachmentPicker] Failed to load media:', error);
    } finally {
      loadingPageRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  }, [rememberLibrary]);

  const initializeLibrary = useCallback(async () => {
    setLoading(true);
    setPermissionDenied(false);
    setLoadFailed(false);
    try {
      const permission = await requestPermissionsAsync(false, ['photo', 'video']);
      if (!permission.granted && permission.accessPrivileges !== 'limited') {
        setPermissionDenied(true);
        setLoading(false);
        return;
      }
      setLimitedAccess(permission.accessPrivileges === 'limited');
      const namedAlbums = await loadAlbums();
      albumsRef.current = namedAlbums;
      setAlbums(namedAlbums);
      activeAlbumIdRef.current = 'all';
      setActiveAlbumId('all');
      setActiveAlbumTitle('All media');
      setAlbumsOpen(false);
      hasMoreRef.current = true;
      await loadMediaPage(true, 'all');
    } catch (error) {
      // Reaching here means permission was granted and something else went
      // wrong - a MediaStore query, most often. Reporting that as denied access
      // is what put "Photo access is off" in front of a user who had granted it.
      console.error('[AttachmentPicker] Failed to initialize media library:', error);
      setLoadFailed(true);
      setLoading(false);
    }
  }, [loadAlbums, loadMediaPage]);

  /**
   * Folds anything new at the front of the grid the user is already looking at.
   *
   * Deliberately not a reload. Re-running the first page and replacing the list
   * would throw away every page scrolled so far and jump the grid; new capture
   * sorts newest-first anyway, so the only thing that can have appeared above
   * what we hold is exactly what this prepends.
   */
  const syncNewMedia = useCallback(async () => {
    if (loadingPageRef.current) return;
    loadingPageRef.current = true;
    try {
      const albumId = activeAlbumIdRef.current;
      let query = new Query()
        .within(AssetField.MEDIA_TYPE, [MediaType.IMAGE, MediaType.VIDEO])
        .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
        .offset(0)
        .limit(MEDIA_PAGE_SIZE);
      const selectedAlbum = albumsRef.current.find((item) => item.album.id === albumId)?.album;
      if (selectedAlbum) query = query.album(selectedAlbum);

      const assets = await query.exe();
      const resolved = await Promise.all(assets.map(resolveLibraryAsset));
      const known = new Set(itemsRef.current.map((item) => item.id));
      const fresh = resolved.filter((item) => !known.has(item.id));
      if (fresh.length) {
        const next = [...fresh, ...itemsRef.current];
        itemsRef.current = next;
        setItems(next);
        offsetRef.current += fresh.length;
      }
      syncedRevision = deviceRevision;
      rememberLibrary();
    } catch (error) {
      // A failed refresh leaves the grid exactly as it was, which is still
      // usable. The next signal will try again.
      console.warn('[AttachmentPicker] Could not refresh media:', error);
    } finally {
      loadingPageRef.current = false;
    }

    // A new capture can also create an album. Best effort and off the critical
    // path: the grid is already correct without it.
    try {
      const namedAlbums = await loadAlbums();
      albumsRef.current = namedAlbums;
      setAlbums(namedAlbums);
      rememberLibrary();
    } catch {
      // Keep the albums we already have.
    }
  }, [loadAlbums, rememberLibrary]);

  const selectAlbum = useCallback((albumId: string, title: string) => {
    activeAlbumIdRef.current = albumId;
    setActiveAlbumId(albumId);
    setActiveAlbumTitle(title);
    setAlbumsOpen(false);
    hasMoreRef.current = true;
    rememberLibrary(title);
    void loadMediaPage(true, albumId);
  }, [loadMediaPage, rememberLibrary]);

  useEffect(() => {
    if (!visible) return;
    setSelection(selected);
    // Only the very first open has nothing to show. After that the grid is
    // already painted, and the most we owe the user is whatever arrived since.
    if (!libraryCache) void initializeLibrary();
    else if (syncedRevision !== deviceRevision) void syncNewMedia();
  }, [initializeLibrary, selected, syncNewMedia, visible]);

  // While the sheet is open, a photo taken elsewhere should appear in it
  // without the user having to close and reopen.
  useEffect(() => {
    if (!visible) return;
    const listener = () => { void syncNewMedia(); };
    revisionListeners.add(listener);
    return () => { revisionListeners.delete(listener); };
  }, [syncNewMedia, visible]);

  const addItems = useCallback((incoming: SelectedChatMedia[]) => {
    setSelection((current) => {
      const known = new Set(current.map((item) => item.id));
      const next = [...current];
      for (const item of incoming) {
        if (!known.has(item.id) && next.length < MAX_CHAT_ATTACHMENTS) {
          known.add(item.id);
          next.push(item);
        }
      }
      if (current.length + incoming.length > MAX_CHAT_ATTACHMENTS) {
        Alert.alert('Attachment limit', `You can send up to ${MAX_CHAT_ATTACHMENTS} items at one time.`);
      }
      return next;
    });
  }, []);

  const toggleItem = useCallback((item: SelectedChatMedia) => {
    setSelection((current) => {
      const existing = current.findIndex((value) => value.id === item.id);
      if (existing >= 0) return current.filter((_, index) => index !== existing);
      if (current.length >= MAX_CHAT_ATTACHMENTS) {
        Alert.alert('Attachment limit', `You can send up to ${MAX_CHAT_ATTACHMENTS} items at one time.`);
        return current;
      }
      return [...current, item];
    });
  }, []);

  const openCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access', 'Allow camera access to take a photo or video.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
    });
    if (!result.canceled) addItems(result.assets.map(normalizePickerAsset));
  }, [addItems]);

  const openFilePicker = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif',
        'image/avif',
        'image/heic',
        'image/heif',
        'video/mp4',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'text/plain',
        'text/csv',
        'application/zip',
        'application/x-rar-compressed',
        'application/vnd.rar',
        'application/x-7z-compressed',
      ],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    addItems(result.assets.map((asset) => {
      return {
        id: `file-${asset.uri}`,
        originalUri: asset.uri,
        currentUri: asset.uri,
        // The source action defines how the message is sent. An image chosen
        // through Files must remain a document instead of becoming photo media.
        kind: 'file' as const,
        fileName: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
      };
    }));
  }, [addItems]);

  const selectSource = useCallback((key: SourceAction['key']) => {
    if (key === 'gallery') setAlbumsOpen((value) => !value);
    if (key === 'camera') void openCamera();
    if (key === 'file') void openFilePicker();
  }, [openCamera, openFilePicker]);

  return (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.header}>
            <TouchableOpacity style={styles.albumTitleButton} onPress={() => setAlbumsOpen((value) => !value)}>
              <Text style={styles.title} numberOfLines={1}>{activeAlbumTitle}</Text>
              <Ionicons name={albumsOpen ? 'chevron-up' : 'chevron-down'} size={17} color={colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.subtitle}>
              {selection.length ? `${selection.length} of ${MAX_CHAT_ATTACHMENTS} selected` : 'Select photos, videos, or files'}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close attachments" onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={23} color={colors.text.primary} />
            </Pressable>
          </View>

          {albumsOpen ? (
            <View style={styles.albumMenu}>
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                <TouchableOpacity style={[styles.albumRow, activeAlbumId === 'all' ? styles.albumRowActive : null]} onPress={() => selectAlbum('all', 'All media')}>
                  <Ionicons name="images" size={20} color={activeAlbumId === 'all' ? colors.primary : colors.text.primary} />
                  <Text style={styles.albumName}>All media</Text>
                  {activeAlbumId === 'all' ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                </TouchableOpacity>
                {albums.map(({ album, title }) => (
                  <TouchableOpacity key={album.id} style={[styles.albumRow, activeAlbumId === album.id ? styles.albumRowActive : null]} onPress={() => selectAlbum(album.id, title)}>
                    <Ionicons name="folder" size={20} color={activeAlbumId === album.id ? colors.primary : colors.text.primary} />
                    <Text style={styles.albumName} numberOfLines={1}>{title}</Text>
                    {activeAlbumId === album.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.gridArea}>
            {loading && items.length === 0 ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.stateText}>Loading recent media</Text>
              </View>
            ) : permissionDenied ? (
              <View style={styles.centerState}>
                <Ionicons name="images-outline" size={36} color={colors.text.secondary} />
                <Text style={styles.stateTitle}>Photo access is off</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={() => void initializeLibrary()}>
                  <Text style={styles.permissionButtonText}>Allow access</Text>
                </TouchableOpacity>
              </View>
            ) : loadFailed ? (
              <View style={styles.centerState}>
                <Ionicons name="refresh-circle-outline" size={36} color={colors.text.secondary} />
                <Text style={styles.stateTitle}>Could not open your gallery</Text>
                <TouchableOpacity style={styles.permissionButton} onPress={() => void initializeLibrary()}>
                  <Text style={styles.permissionButtonText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                nestedScrollEnabled
                data={items}
                numColumns={GRID_COLUMNS}
                keyExtractor={(item) => item.id}
                showsVerticalScrollIndicator={false}
                columnWrapperStyle={styles.gridRow}
                onEndReached={() => void loadMediaPage(false)}
                onEndReachedThreshold={0.65}
                ListHeaderComponent={limitedAccess ? (
                  <TouchableOpacity
                    style={styles.limitedAccess}
                    onPress={() => void presentPermissionsPicker(['photo', 'video']).then(initializeLibrary)}
                  >
                    <Ionicons name="add-circle-outline" size={19} color={colors.primary} />
                    <Text style={styles.limitedAccessText}>Allow access to more photos and videos</Text>
                  </TouchableOpacity>
                ) : null}
                ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.pageLoader} color={colors.primary} /> : null}
                renderItem={({ item }) => {
                  const order = selectedIndex.get(item.id);
                  return (
                    <Pressable style={styles.cell} onPress={() => toggleItem(item)}>
                      <MediaThumbnail item={item} style={styles.cellImage} />
                      {item.kind === 'video' ? (
                        <View style={styles.durationBadge}>
                          <Ionicons name="videocam" size={12} color="#fff" />
                          <Text style={styles.durationText}>{formatDuration(item.durationMs)}</Text>
                        </View>
                      ) : null}
                      <View style={[styles.check, order ? styles.checkSelected : null]}>
                        {order ? <Text style={styles.checkText}>{order}</Text> : null}
                      </View>
                      {order ? <View pointerEvents="none" style={styles.selectedOverlay} /> : null}
                    </Pressable>
                  );
                }}
              />
            )}
          </View>

          <View style={styles.sourceBar}>
            {SOURCE_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.key}
                activeOpacity={0.72}
                style={styles.sourceAction}
                onPress={() => selectSource(action.key)}
              >
                <View style={[styles.sourceIcon, action.key === 'gallery' ? styles.sourceIconActive : null]}>
                  <Ionicons name={action.icon} size={22} color={action.key === 'gallery' ? '#fff' : colors.text.primary} />
                </View>
                <Text style={[styles.sourceLabel, action.key === 'gallery' ? styles.sourceLabelActive : null]}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {selection.length > 0 ? (
            <TouchableOpacity style={styles.continueButton} activeOpacity={0.78} onPress={() => onContinue(selection)}>
              <Text style={styles.continueText}>Send media</Text>
              <View style={styles.countBadge}><Text style={styles.countText}>{selection.length}</Text></View>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </TouchableOpacity>
          ) : null}
        </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: '#242321',
    overflow: 'hidden',
  },
  closeButton: { position: 'absolute', right: 12, top: 7, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  header: { height: 58, paddingHorizontal: 18, justifyContent: 'center', zIndex: 31 },
  albumTitleButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '82%', gap: 5 },
  title: { color: colors.text.primary, fontSize: 17, fontWeight: '700' },
  subtitle: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  albumMenu: {
    position: 'absolute', top: 68, left: 12, right: 12, maxHeight: 310, zIndex: 30,
    borderRadius: 16, overflow: 'hidden', paddingVertical: 6,
    backgroundColor: '#252528', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
    elevation: 12,
  },
  albumRow: { height: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  albumRowActive: { backgroundColor: 'rgba(255,255,255,0.06)' },
  albumName: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: '600' },
  gridArea: { flex: 1, backgroundColor: '#0D0D0E' },
  gridRow: { gap: GRID_GAP, marginBottom: GRID_GAP },
  cell: { width: CELL_SIZE, height: CELL_SIZE, backgroundColor: '#242427' },
  cellImage: { width: '100%', height: '100%' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#27272A' },
  selectedOverlay: { ...StyleSheet.absoluteFill, borderWidth: 3, borderColor: colors.primary, backgroundColor: 'rgba(255,90,95,0.10)' },
  check: {
    position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.28)', alignItems: 'center', justifyContent: 'center', zIndex: 2,
  },
  checkSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  durationBadge: {
    position: 'absolute', left: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 5, height: 20, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.62)',
  },
  durationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  stateText: { color: colors.text.secondary, fontSize: 13 },
  stateTitle: { color: colors.text.primary, fontSize: 16, fontWeight: '700' },
  permissionButton: { marginTop: 4, borderRadius: 18, paddingVertical: 9, paddingHorizontal: 18, backgroundColor: colors.primary },
  permissionButtonText: { color: '#fff', fontWeight: '700' },
  limitedAccess: { width: SCREEN_WIDTH, minHeight: 44, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1B1B1E' },
  limitedAccessText: { color: colors.text.primary, fontSize: 13, fontWeight: '600' },
  pageLoader: { height: 46 },
  sourceBar: {
    height: 78, marginHorizontal: 12, marginTop: 10, borderRadius: 22, overflow: 'hidden',
    backgroundColor: '#302F2D', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
  },
  sourceAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  sourceIcon: { width: 36, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sourceIconActive: { backgroundColor: colors.primary },
  sourceLabel: { color: colors.text.secondary, fontSize: 11, fontWeight: '600' },
  sourceLabelActive: { color: colors.text.primary },
  continueButton: {
    height: 50, marginHorizontal: 12, marginTop: 9, borderRadius: 16, backgroundColor: colors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
  },
  continueText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  countBadge: { minWidth: 23, height: 23, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.18)' },
  countText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});

/** Android owns the sheet height, drag gesture, dimming and dismissal. */
export function ChatAttachmentsScreen() {
  const navigation = useNavigation<any>();
  const { params } = useRoute<any>();
  const requestId = params.requestId as string;
  const [selected] = useState(() => attachmentPickerSelection(requestId));
  const result = useRef<SelectedChatMedia[] | null>(null);
  const closing = useRef(false);
  const finishFrame = useRef<number | null>(null);
  useEffect(() => {
    if (finishFrame.current !== null) cancelAnimationFrame(finishFrame.current);
    const unsubscribe = navigation.addListener('transitionEnd', (event: any) => {
      if (event.data.closing) finishAttachmentPickerRequest(requestId, result.current);
    });
    return () => {
      unsubscribe();
      // Drag dismissal can unmount the native route before transitionEnd.
      finishFrame.current = requestAnimationFrame(() => finishAttachmentPickerRequest(requestId, result.current));
    };
  }, [navigation, requestId]);
  const close = (items: SelectedChatMedia[] | null = null) => {
    if (closing.current) return;
    closing.current = true;
    result.current = items;
    navigation.goBack();
  };
  return <AttachmentPickerSheet visible selected={selected} onClose={() => close()} onContinue={items => close(items)} />;
}
