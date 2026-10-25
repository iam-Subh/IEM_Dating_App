import { makeMainPhoto, profilePhotoUrls, validProfileVideoDuration } from '../onboarding/profileValues';
import { completeProfileUpload, explicitUploadMessage, tellBeingChecked } from '../../safety/mediaCheck';
import { PhotoIntroduction } from '../onboarding/PhotoIntroduction';
import { NativeCameraRecorder } from '../onboarding/ProfileVideoRecorder';
import { ProfileVideoPreview } from '../onboarding/ProfileVideoPreview';
import {afterScreenTransition} from '../onboarding/afterScreenTransition';
import {videoPosters} from '../onboarding/videoPosterService';
import { ProfilePhotoPreview } from '../onboarding/ProfilePhotoPreview';
import { PhotoCropModal } from '../../../screens/main/profile/PhotoCropModal';
import { connectionColors } from '../onboarding/ConnectionDesign';
import { useOnboarding } from '../onboarding/useOnboarding';
import { rose } from '../onboarding/theme';
import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Alert,
  InteractionManager,
  Modal,
  Linking
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { photoExtFromAsset, videoExtFromAsset } from '../../../utils/mediaFileExt';
import { Video } from 'react-native-compressor';
import { useDispatch } from "react-redux";
import { saveOnboardingDraft, updateUser } from "../../../store/authSlice";
import { api } from "../../../services/api";
import { LastPhotoWarningModal } from '../../../components/LastPhotoWarningModal';
import { File as FileSystemFile, UploadType as FileSystemUploadType } from 'expo-file-system';

const WebCameraRecorder = ({ onRecord, onCancel }: { onRecord: (uri: string) => void, onCancel: () => void }) => {
  const videoRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const recordingStarted = useRef(0);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error(err);
        Alert.alert("Camera Error", "Could not access the camera. Please check your browser permissions.");
        onCancel();
      }
    };
    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track: any) => track.stop());
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    recordingStarted.current = Date.now();
    
    // We try to use webm if possible, or mp4 if supported
    let options = { mimeType: 'video/webm;codecs=vp8,opus' };
    if (!(window as any).MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: 'video/mp4' }; 
    }
    
    const mediaRecorder = new (window as any).MediaRecorder(streamRef.current, options);
    mediaRecorder.ondataavailable = (e: any) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mediaRecorder.onstop = () => {
      if (Date.now() - recordingStarted.current < 15000) { Alert.alert('Video too short', 'Record at least 15 seconds.'); return; }
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      onRecord(url);
    };
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => { setElapsed(prev => prev + 1); if (Date.now() - recordingStarted.current >= 60000 && mediaRecorder.state === 'recording') { mediaRecorder.stop(); setIsRecording(false); clearInterval(timerRef.current); } }, 1000);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {Platform.OS === 'web' && React.createElement('video', {
          ref: videoRef,
          autoPlay: true,
          playsInline: true,
          muted: true, // Mute local playback to avoid echo
          style: { width: '100%', height: '100%', objectFit: 'cover' }
        })}
        
        {isRecording && (
          <View style={{ position: 'absolute', top: 50, width: '100%', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(249, 78, 39, 0.8)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FBF1F7', marginRight: 8 }} />
              <Text style={{ color: '#FBF1F7', fontWeight: '700', fontSize: 16 }}>{formatTime(elapsed)} / 1:00</Text>
            </View>
          </View>
        )}

        <View style={{ position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' }}>
            <TouchableOpacity onPress={onCancel} style={{ padding: 10, width: 80, alignItems: 'center' }}>
              <Text style={{ color: '#FBF1F7', fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={isRecording ? stopRecording : startRecording}
              style={{
                width: 76, height: 76, borderRadius: 38, 
                backgroundColor: isRecording ? '#E47CA6' : '#FBF1F7',
                justifyContent: 'center', alignItems: 'center',
                borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)'
              }}
            >
              <View style={{ 
                width: isRecording ? 26 : 56, 
                height: isRecording ? 26 : 56, 
                borderRadius: isRecording ? 4 : 28, 
                backgroundColor: isRecording ? '#FBF1F7' : '#E47CA6' 
              }} />
            </TouchableOpacity>
            
            <View style={{ width: 80 }} />
          </View>
        </View>
      </View>
    </View>
  );
};

/**
 * Where the real-person check stands after a save. Someone who already took
 * the selfie had their changed media re-checked by the save itself, so they
 * see that outcome. A first check returns nothing and starts with the selfie.
 */
async function faceRecheck() {
  try {
    const face = (await api.get('/verification/face')).data.data;
    if (!['verified', 'pending_review', 'needs_fix'].includes(face?.status) || !face.items?.length) return undefined;
    return {status: face.status, reason: face.reason, items: face.items};
  } catch {
    return undefined;
  }
}

/** The stored file a URL names, whichever host served it (storage or CDN). */
function mediaPath(url: string | null | undefined) {
  if (!url) return '';
  try { return new URL(url).pathname; } catch { return url; }
}

export const PhotoUploadScreen = () => {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();
  const o = useOnboarding();

  const route = useRoute<any>();
  const saved = o.auth.user;
  const mediaDraft = Platform.OS === 'web' ? null : o.auth.onboardingDraft?.fields.mediaDraft;
  const [videoUri, setVideoUri] = useState<string | null>(mediaDraft?.videoUri ?? saved?.profileVideoUrl ?? null);
  const [photos, setPhotos] = useState<(string | null)[]>(Array.from({ length: 6 }, (_, index) => mediaDraft?.photos?.[index] ?? profilePhotoUrls(saved?.photos)[index] ?? null));
  const [originalPhotos, setOriginalPhotos] = useState<(string | null)[]>(Array.from({length: 6}, (_, index) => mediaDraft?.originalPhotos?.[index] ?? null));
  useEffect(() => {
    if (Platform.OS !== 'web') dispatch(saveOnboardingDraft({ fields: { mediaDraft: { videoUri, photos, originalPhotos } } }));
  }, [videoUri, photos, originalPhotos, dispatch]);
  useEffect(() => {
    if (Platform.OS === 'web' || !mediaDraft) return;
    const exists = (uri: string | null) => !uri || /^https?:/.test(uri) || new FileSystemFile(uri).exists;
    if (!exists(videoUri)) setVideoUri(null);
    setPhotos(current => current.map(uri => exists(uri) ? uri : null));
    setOriginalPhotos(current => current.map(uri => exists(uri) ? uri : null));
  }, []);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pickerError, setPickerError] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const completedUploads = useRef(new Map<string, string>());
  const [showPreview, setShowPreview] = useState(false);
  const [previewPrepared, setPreviewPrepared] = useState(false);
  const openPreview = () => {setPreviewPrepared(true); setShowPreview(true);};
  const [photoPreviewIndex, setPhotoPreviewIndex] = useState<number | null>(null);
  const [showNativeCamera, setShowNativeCamera] = useState(false);
  const [showWebCamera, setShowWebCamera] = useState(false);
  const [cropImage, setCropImage] = useState<{ uri: string, index: number } | null>(null);
  const [protectedPhotoIndex, setProtectedPhotoIndex] = useState<number | null>(null);
  const mediaPickerBusy = useRef(false);

  const ensureGalleryAccess = async (kind: 'photo' | 'video') => {
    setPickerError('');
    // ImagePicker uses the system picker on Android 13+ and does not request
    // library access. MediaLibrary requests the native, granular permission.
    let access = Platform.OS === 'android'
      ? await MediaLibrary.getPermissionsAsync(false, [kind])
      : await ImagePicker.getMediaLibraryPermissionsAsync();
    if (access.granted || access.accessPrivileges === 'limited') return true;
    if (access.canAskAgain) {
      access = Platform.OS === 'android'
        ? await MediaLibrary.requestPermissionsAsync(false, [kind])
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    }
    if (access.granted || access.accessPrivileges === 'limited') return true;
    setPickerError(`Allow ${kind} access to choose a ${kind} from your gallery.`);
    if (!access.canAskAgain) Alert.alert('Gallery access needed', `Enable ${kind} access in app settings.`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Open settings', onPress: () => {void Linking.openSettings().catch(() => setPickerError('Could not open settings. Open the app permissions in your device settings.'));}},
    ]);
    return false;
  };

  const handleVideoSelection = async (type: 'library' | 'camera') => {
    if (type === 'camera') {
      if (Platform.OS === 'web') setShowWebCamera(true);
      else setShowNativeCamera(true);
      return;
    }
    if (mediaPickerBusy.current) return;
    mediaPickerBusy.current = true;
    try {
      if (!await ensureGalleryAccess('video')) return;
      const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['videos'], allowsEditing: true, quality: 1});
      if (!result.canceled && result.assets?.length) {
        if (!validProfileVideoDuration(result.assets[0].duration)) {Alert.alert('Check video length', 'Choose a video of 15–60 seconds.'); return;}
        setVideoUri(result.assets[0].uri);
        setPickerError('');
      }
    } catch {
      setPickerError('Could not open the video gallery. Try again.');
    } finally {
      mediaPickerBusy.current = false;
    }
  };

  const openOptions = (kind: 'photo' | 'video', index = 0) => navigation.navigate('PhotoMediaOptions', {kind, index, hasMedia: kind === 'video' ? !!videoUri : !!photos[index], photoUri: kind === 'photo' ? photos[index] : undefined, returnKey: route.key});

  const correctionTarget = route.params?.correctionTarget;
  useEffect(() => {
    if (!correctionTarget) return;
    return afterScreenTransition(navigation, () => {
      navigation.setParams({correctionTarget: undefined});
      // The check reports stored addresses; the profile may serve the same file from the CDN.
      const index = correctionTarget.url ? photos.findIndex(uri => !!uri && mediaPath(uri) === mediaPath(correctionTarget.url)) : 0;
      if (correctionTarget.kind === 'video') openOptions('video');
      else if (index >= 0) openOptions('photo', index);
      else setPickerError('This photo has changed. Choose the photo you want to update.');
    });
  }, [correctionTarget, navigation]);

  // Return data is serializable. Start the picker after the native sheet closes.
  const returnedAction = route.params?.photoMediaAction;
  useLayoutEffect(() => {
    if (!returnedAction) return;
    const {action, index} = returnedAction;
    setUploadError('');
    if (action === 'main') {
      navigation.setParams({photoMediaAction: undefined});
      setPhotos(current => makeMainPhoto(current, index));
      setOriginalPhotos(current => makeMainPhoto(current, index));
    } else if (action === 'remove') {
      navigation.setParams({photoMediaAction: undefined});
      if (typeof index === 'number' && returnedAction.kind !== 'video') removeImage(index);
      else setVideoUri(null);
    } else {
      return afterScreenTransition(navigation, () => {
        navigation.setParams({photoMediaAction: undefined});
        if (action === 'crop') {
          const uri = originalPhotos[index] || photos[index];
          if (uri) setCropImage({uri, index});
        } else if (action === 'preview') openPreview();
        else if (action === 'replace') void pickImage(index);
        else void handleVideoSelection(action);
      });
    }
  }, [returnedAction]);

  const pickImage = async (index: number) => {
    if (mediaPickerBusy.current) return;
    mediaPickerBusy.current = true;
    // The first selected image is the main photo, regardless of the tapped slot.
    if (!photos.some(Boolean)) index = 0;
    try {
      if (!await ensureGalleryAccess('photo')) return;
      const result = await ImagePicker.launchImageLibraryAsync({mediaTypes: ['images'], allowsEditing: false, quality: 1});
      if (!result.canceled && result.assets?.length) {
        setCropImage({uri: result.assets[0].uri, index});
        setPickerError('');
      }
    } catch {
      setPickerError('Could not open the photo gallery. Try again.');
    } finally {
      mediaPickerBusy.current = false;
    }
  };

  const removeImage = (index: number) => {
    if (!photos[index]) return;
    if (photos.filter(Boolean).length <= 1) {
      setProtectedPhotoIndex(index);
      return;
    }
    const kept = photos.map((uri, slot) => ({ uri, original: originalPhotos[slot] })).filter((photo, slot) => slot !== index && !!photo.uri);
    const newPhotos = [...kept.map(photo => photo.uri), ...Array(6 - kept.length).fill(null)];
    setPhotos(newPhotos);
    
    const newOriginals = [...kept.map(photo => photo.original), ...Array(6 - kept.length).fill(null)];
    setOriginalPhotos(newOriginals);
  };

  const handleFinish = async () => {
    if (!videoUri || !photos.some(Boolean)) {
      Alert.alert('Add a profile photo', 'Add at least one photo and a profile video of 15–60 seconds.');
      return;
    }
    setIsUploading(true);
    setUploadError('');
    setUploadProgress(null);
    setUploadStatus('Preparing your media…');
    try {
      const filePayloads: { id: string, type: 'video' | 'photo', ext: string, uri: string }[] = [];
      let finalVideoUri = videoUri;

      // 1. Compression (Native only, bypass for web)
      if (videoUri && !/^https?:/.test(videoUri) && !completedUploads.current.has(videoUri) && Platform.OS !== 'web') {
        console.log('Compressing video natively...');
        try {
           finalVideoUri = await Video.compress(videoUri, {
             compressionMethod: 'auto',
             minimumFileSizeForCompress: 2, // Only compress if larger than 2MB
           });
           console.log('Compression successful: ', finalVideoUri);
        } catch (err) {
           console.log('Compression failed, falling back to original...', err);
        }
      }

      // 2. Prepare Payload
      if (finalVideoUri && !/^https?:/.test(finalVideoUri) && !completedUploads.current.has(videoUri)) {
         const videoExt = videoExtFromAsset(finalVideoUri);
         filePayloads.push({ id: 'vid', type: 'video', ext: videoExt, uri: finalVideoUri });
      }

      const validPhotos = photos.map((uri, i) => ({ uri, index: i })).filter(p => p.uri !== null);
      validPhotos.filter(photo => !/^https?:/.test(photo.uri!) && !completedUploads.current.has(photo.uri!)).forEach((photo) => {
         const photoExt = photoExtFromAsset(photo.uri!);
         filePayloads.push({ id: `photo_${photo.index}`, type: 'photo', ext: photoExt, uri: photo.uri! });
      });

      // 3. Request AWS Presigned URLs
      console.log('Requesting Direct S3 Upload Tickets...');
      const uploadTickets = filePayloads.length ? (await api.post('/upload/presigned-urls', { files: filePayloads.map(f => ({ type: f.type, ext: f.ext })) })).data.data : [];
      let completed = 0;
      if (filePayloads.length) {setUploadProgress(0); setUploadStatus(`Uploading 0 of ${filePayloads.length} files…`);}

      // 4. HTTP PUT directly to S3
      console.log('Pushing binaries directly to S3...');
      // Files the nudity check sent to the team: told once the profile is saved.
      const heldForReview: ('photo' | 'video')[] = [];
      const uploads = await Promise.allSettled(filePayloads.map(async (file, index) => {
         const ticket = uploadTickets[index];
         
         // React Native's fetch takes Content-Type from the blob's own type,
         // which is empty for a file:// blob. That silently overrode the header,
         // so S3 stored the object untyped and completion rejected it as not
         // matching its ticket. A native streaming upload sends the header
         // verbatim and never holds the whole video in memory.
         if (Platform.OS === 'web') {
           const response = await fetch(file.uri);
           const raw = await response.blob();
           const body = raw.type === ticket.contentType ? raw : new Blob([raw], { type: ticket.contentType });
           const s3Res = await fetch(ticket.uploadUrl, {
             method: 'PUT',
             body,
             headers: { 'Content-Type': ticket.contentType },
           });
           if (!s3Res.ok) {
             throw new Error(`S3 Upload failed for ${file.type} with status ${s3Res.status}`);
           }
         } else {
           const uri = file.uri.startsWith('file://') ? file.uri : `file://${file.uri}`;
           const result = await new FileSystemFile(uri).upload(ticket.uploadUrl, {
             httpMethod: 'PUT',
             uploadType: FileSystemUploadType.BINARY_CONTENT,
             mimeType: ticket.contentType,
             headers: { 'Content-Type': ticket.contentType },
           });
           if (result.status < 200 || result.status >= 300) {
             throw new Error(`S3 Upload failed for ${file.type} with status ${result.status}`);
           }
         }
         if ((await completeProfileUpload(ticket.assetId)).review) heldForReview.push(file.type === 'video' ? 'video' : 'photo');
         completedUploads.current.set(file.type === 'video' ? videoUri : file.uri, ticket.fileUrl);
         completed += 1;
         setUploadProgress(completed / filePayloads.length);
         setUploadStatus(`Uploading ${completed} of ${filePayloads.length} files…`);

         return { type: file.type, url: ticket.fileUrl, id: file.id };
      }));
      const failed = uploads.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const uploadResults = uploads.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);

      const uploadedVideo = uploadResults.find(r => r.type === 'video')?.url || completedUploads.current.get(videoUri) || (/^https?:/.test(videoUri) ? videoUri : null);
      if (uploadedVideo && videoUri) videoPosters.copy(videoUri, uploadedVideo);
      // Filter and sort photos by their original index to maintain order
      const uploadedPhotosSorted = validPhotos.map(photo => uploadResults.find(item => item.id === `photo_${photo.index}`)?.url ?? completedUploads.current.get(photo.uri!) ?? photo.uri!);

      // 5. Save Final Web-Resolution Links
      console.log('Media uploaded. Saving URLs to profile...');
      setUploadStatus('Saving your profile…');
      setUploadProgress(null);
      const profileUpdateRes = await api.put('/profile', {
         profileVideoUrl: uploadedVideo,
         photos: uploadedPhotosSorted,
         avatarUrl: uploadedPhotosSorted[0] || null // Explicitly sync the first photo as avatar
      });

      if (profileUpdateRes.data?.success) {
        dispatch(updateUser(profileUpdateRes.data.data));
        if (heldForReview.length) tellBeingChecked(heldForReview.includes('video') && heldForReview.length === 1 ? 'video' : 'photo', heldForReview.length);
        
        dispatch(saveOnboardingDraft({ step: 'OnboardingReview', fields: { mediaDraft: null } }));
        if (route.params?.reviewEdit) navigation.goBack();
        else navigation.replace('RealPersonCheck', { onboarding: true, returnToReview: true, recheck: await faceRecheck() });
      } else {
        throw new Error('Profile update failed on server');
      }
    } catch (error: any) {
      console.error("Upload failed", error?.response?.data || error);
      // A refusal with a reason ("this doesn't look like you") says so: the
      // generic line hid why a replacement never reached the profile.
      const notYou = error?.response?.data?.code === 'MAIN_PHOTO_NOT_YOU';
      const explicit = explicitUploadMessage(error);
      setUploadError(notYou ? `${error.response.data.message} Choose another photo and tap Retry upload.`
        : explicit ? `${explicit} Choose another and tap Retry upload.`
        : 'Could not save your media. Your selections are still here. Tap Retry upload.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <View style={{flex: 1, backgroundColor: connectionColors.canvas}}>
      <PhotoIntroduction photos={photos} videoUri={videoUri} busy={isUploading}
        error={uploadError || pickerError} status={uploadStatus} progress={uploadProgress}
        label={uploadError ? 'Retry upload' : route.params?.reviewEdit ? 'Save media' : 'Continue'}
        onBack={o.back} onNext={handleFinish}
        onPhoto={index => {setUploadError(''); if (photos[index]) setPhotoPreviewIndex(index); else void pickImage(index);}}
        onPhotoOptions={index => openOptions('photo', index)}
        onVideo={() => openOptions('video')} onPlay={openPreview}/>
      {photoPreviewIndex !== null && <ProfilePhotoPreview photos={photos} index={photoPreviewIndex} onIndex={setPhotoPreviewIndex} onClose={() => setPhotoPreviewIndex(null)}/>}
      {videoUri && previewPrepared && <ProfileVideoPreview key={videoUri} uri={videoUri} visible={showPreview} onClose={() => setShowPreview(false)}/>}

      <Modal visible={showWebCamera} transparent animationType="slide">
        <WebCameraRecorder 
          onCancel={() => setShowWebCamera(false)} 
          onRecord={(uri) => {
            setVideoUri(uri);
            setShowWebCamera(false);
          }} 
        />
      </Modal>

      <Modal visible={showNativeCamera} transparent hardwareAccelerated animationType="slide" onRequestClose={() => setShowNativeCamera(false)}>
        <NativeCameraRecorder 
          onCancel={() => setShowNativeCamera(false)}
          onLibrary={() => {setShowNativeCamera(false); InteractionManager.runAfterInteractions(() => void handleVideoSelection('library'));}}
          onRecord={(uri) => {
            setVideoUri(uri);
            setShowNativeCamera(false);
          }} 
        />
      </Modal>

      {cropImage && <PhotoCropModal
        key={cropImage.uri + cropImage.index}
        appearance="onboarding"
        initialAspectRatio={1}
        imageUri={cropImage.uri}
        onCancel={() => setCropImage(null)}
        onSave={cropped => {
          setPhotos(current => current.map((uri, index) => index === cropImage.index ? cropped.uri : uri));
          setOriginalPhotos(current => current.map((uri, index) => index === cropImage.index ? cropImage.uri : uri));
          setCropImage(null);
          setProtectedPhotoIndex(null);
          setPickerError('');
        }}/>}

      <LastPhotoWarningModal
        appearance="onboarding"
        visible={protectedPhotoIndex !== null && Boolean(photos[protectedPhotoIndex])}
        imageUri={protectedPhotoIndex !== null ? photos[protectedPhotoIndex] || undefined : undefined}
        onClose={() => setProtectedPhotoIndex(null)}
        onReplace={() => { const index = protectedPhotoIndex; setProtectedPhotoIndex(null); if (index !== null) void pickImage(index); }}
      />
    </View>
  );
};

