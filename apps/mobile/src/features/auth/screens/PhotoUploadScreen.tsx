import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
  Animated,
  SafeAreaView,
  Image,
  ActivityIndicator,
  Platform,
  Alert,
  ActionSheetIOS,
  Modal
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Video } from 'react-native-compressor';
import { useDispatch } from "react-redux";
import { completeOnboarding, updateUser } from "../../../store/authSlice";
import { api } from "../../../services/api";
import { store } from "../../../store";

let Cropper: any = null;
if (Platform.OS === 'web') {
  Cropper = require('react-easy-crop').default;
}

type VideoPreviewProps = {
  uri: string;
};

const VideoPreview = ({ uri }: VideoPreviewProps) => {
  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);

  const player = useVideoPlayer(uri, (player) => {
    player.loop = false; // Stop looping to allow one full play
    player.muted = true;
    player.play();
  });

  useEffect(() => {
    if (!player) return;

    // Sync initial state
    setIsPlaying(player.playing);

    const playingSub = player.addListener('playingChange', (event) => {
      setIsPlaying(event.isPlaying);
      if (event.isPlaying) {
        setHasEnded(false);
      }
    });

    const endSub = player.addListener('playToEnd', () => {
      setIsPlaying(false);
      setHasEnded(true);
    });

    return () => {
      playingSub.remove();
      endSub.remove();
    };
  }, [player]);

  const toggleMute = (e: any) => {
    // Prevent the parent touchable from catching this event
    e.stopPropagation();
    const nextMuted = !isMuted;
    player.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const togglePlay = (e: any) => {
    e.stopPropagation();
    if (player.playing) {
      player.pause();
    } else {
      if (hasEnded) {
        player.seekBy(-player.currentTime); // replay from start
        setHasEnded(false);
      }
      player.play();
    }
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView 
        style={styles.heroMedia} 
        player={player} 
        nativeControls={false}
        contentFit="cover"
      />
      <View style={styles.videoControlsOverlay}>
        <TouchableOpacity style={styles.controlButton} onPress={togglePlay}>
          <MaterialCommunityIcons name={isPlaying ? "pause" : "play"} size={20} color="#FFF" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={toggleMute}>
          <MaterialCommunityIcons name={isMuted ? "volume-off" : "volume-high"} size={20} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const getCroppedImg = (imageSrc: string, pixelCrop: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    const image = new (globalThis as any).Image();
    image.src = imageSrc;
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelCrop.width;
      canvas.height = pixelCrop.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('No 2d context'));
      ctx.drawImage(
        image,
        pixelCrop.x,
        pixelCrop.y,
        pixelCrop.width,
        pixelCrop.height,
        0,
        0,
        pixelCrop.width,
        pixelCrop.height
      );
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Canvas is empty'));
        resolve(URL.createObjectURL(blob));
      }, 'image/jpeg');
    };
    image.onerror = (error: any) => reject(error);
  });
};

const WebCropModal = ({ imageUri, onCrop, onCancel }: { imageUri: string, onCrop: (uri: string) => void, onCancel: () => void }) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<any>(null);

  const onCropComplete = (croppedArea: any, croppedAreaPixels: any) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const handleSave = async () => {
    try {
      const croppedImg = await getCroppedImg(imageUri, croppedAreaPixels);
      onCrop(croppedImg);
    } catch(e) {
      console.error(e);
      onCancel();
    }
  };

  if (!Cropper) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {Platform.OS === 'web' && React.createElement('div', { style: { position: 'relative', width: '100%', height: '85%' } }, 
          <Cropper
            image={imageUri}
            crop={crop}
            zoom={zoom}
            aspect={3 / 4}
            objectFit="contain"
            onCropChange={setCrop}
            onCropComplete={onCropComplete}
            onZoomChange={setZoom}
            style={{
              containerStyle: { backgroundColor: '#000' },
              overlayStyle: { backgroundColor: 'rgba(0,0,0,0.85)' }
            }}
          />
        )}
        <View style={{ height: '15%', justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 20 }}>
          <TouchableOpacity onPress={onCancel} style={{ padding: 10 }}>
            <Text style={{ color: '#FFF', fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSave} style={{ backgroundColor: '#F94E27', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 20 }}>
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700' }}>Crop & Save</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const NativeCameraRecorder = ({ onRecord, onCancel }: { onRecord: (uri: string) => void, onCancel: () => void }) => {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const cameraRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!cameraPermission?.granted) requestCameraPermission();
    if (!microphonePermission?.granted) requestMicrophonePermission();
    return () => clearInterval(timerRef.current);
  }, [cameraPermission, microphonePermission]);

  if (!cameraPermission?.granted || !microphonePermission?.granted) {
    return (
      <View style={{flex:1, backgroundColor:'#000', justifyContent:'center', alignItems:'center'}}>
        <ActivityIndicator color="#FFF" />
      </View>
    );
  }

  const startRecording = async () => {
    if (cameraRef.current) {
      setIsRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
      try {
        const video = await cameraRef.current.recordAsync({
          maxDuration: 60,
        });
        if (video && video.uri) {
           onRecord(video.uri);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsRecording(false);
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }
  };

  const stopRecording = () => {
    if (cameraRef.current && isRecording) {
      cameraRef.current.stopRecording();
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <View style={StyleSheet.absoluteFill}>
       <CameraView 
         ref={cameraRef}
         style={{ flex: 1 }} 
         facing="front"
         mode="video"
       >
         {isRecording && (
          <View style={{ position: 'absolute', top: 50, width: '100%', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(249, 78, 39, 0.8)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF', marginRight: 8 }} />
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 16 }}>{formatTime(elapsed)} / 1:00</Text>
            </View>
          </View>
        )}

        <View style={{ position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' }}>
            <TouchableOpacity onPress={onCancel} style={{ padding: 10, width: 80, alignItems: 'center' }}>
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={isRecording ? stopRecording : startRecording}
              style={{
                width: 76, height: 76, borderRadius: 38, 
                backgroundColor: isRecording ? '#F94E27' : '#FFF',
                justifyContent: 'center', alignItems: 'center',
                borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)'
              }}
            >
              <View style={{ 
                width: isRecording ? 26 : 56, 
                height: isRecording ? 26 : 56, 
                borderRadius: isRecording ? 4 : 28, 
                backgroundColor: isRecording ? '#FFF' : '#F94E27' 
              }} />
            </TouchableOpacity>
            
            <View style={{ width: 80 }} />
          </View>
        </View>
       </CameraView>
    </View>
  );
};

const WebCameraRecorder = ({ onRecord, onCancel }: { onRecord: (uri: string) => void, onCancel: () => void }) => {
  const videoRef = useRef<any>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<any>(null);
  const timerRef = useRef<any>(null);

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
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      onRecord(url);
    };
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();
    setIsRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
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
          style: { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }
        })}
        
        {isRecording && (
          <View style={{ position: 'absolute', top: 50, width: '100%', alignItems: 'center' }}>
            <View style={{ backgroundColor: 'rgba(249, 78, 39, 0.8)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF', marginRight: 8 }} />
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 16 }}>{formatTime(elapsed)} / 1:00</Text>
            </View>
          </View>
        )}

        <View style={{ position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-evenly' }}>
            <TouchableOpacity onPress={onCancel} style={{ padding: 10, width: 80, alignItems: 'center' }}>
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              onPress={isRecording ? stopRecording : startRecording}
              style={{
                width: 76, height: 76, borderRadius: 38, 
                backgroundColor: isRecording ? '#F94E27' : '#FFF',
                justifyContent: 'center', alignItems: 'center',
                borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)'
              }}
            >
              <View style={{ 
                width: isRecording ? 26 : 56, 
                height: isRecording ? 26 : 56, 
                borderRadius: isRecording ? 4 : 28, 
                backgroundColor: isRecording ? '#FFF' : '#F94E27' 
              }} />
            </TouchableOpacity>
            
            <View style={{ width: 80 }} />
          </View>
        </View>
      </View>
    </View>
  );
};

export const PhotoUploadScreen = () => {
  const navigation = useNavigation<any>();
  const dispatch = useDispatch();

  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [photos, setPhotos] = useState<(string | null)[]>(Array(6).fill(null));
  const [originalWebPhotos, setOriginalWebPhotos] = useState<(string | null)[]>(Array(6).fill(null));
  const [isUploading, setIsUploading] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showNativeCamera, setShowNativeCamera] = useState(false);
  const [showWebCamera, setShowWebCamera] = useState(false);
  const [webCropImage, setWebCropImage] = useState<{ uri: string, index: number } | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const modalScale = useRef(new Animated.Value(0.8)).current;
  const modalOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleVideoSelection = async (type: 'library' | 'camera') => {
    let result;
    if (type === 'camera') {
      if (Platform.OS === 'web') {
        setShowWebCamera(true);
        return;
      }
      setShowNativeCamera(true);
      return;
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Sorry, we need camera roll permissions to select a video!');
        return;
      }
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 1,
      });
    }

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setVideoUri(result.assets[0].uri);
    }
  };

  const openVideoModal = () => {
    setShowVideoModal(true);
    Animated.parallel([
      Animated.spring(modalScale, {
        toValue: 1,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(modalOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeVideoModal = () => {
    Animated.parallel([
      Animated.spring(modalScale, {
        toValue: 0.8,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(modalOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => setShowVideoModal(false));
  };

  const pickVideo = () => {
    openVideoModal();
  };

  const pickImage = async (index: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Sorry, we need camera roll permissions to make this work!');
      return;
    }

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      if (Platform.OS === 'web') {
        const rawUri = result.assets[0].uri;
        const newOriginals = [...originalWebPhotos];
        newOriginals[index] = rawUri;
        setOriginalWebPhotos(newOriginals);
        setWebCropImage({ uri: rawUri, index });
      } else {
        const newPhotos = [...photos];
        newPhotos[index] = result.assets[0].uri;
        setPhotos(newPhotos);
      }
    }
  };

  const removeImage = (index: number) => {
    const newPhotos = [...photos];
    newPhotos[index] = null;
    setPhotos(newPhotos);
    
    if (Platform.OS === 'web') {
      const newOriginals = [...originalWebPhotos];
      newOriginals[index] = null;
      setOriginalWebPhotos(newOriginals);
    }
  };

  const handleFinish = async () => {
    setIsUploading(true);
    try {
      const filePayloads: { id: string, type: 'video' | 'photo', ext: string, uri: string }[] = [];
      let finalVideoUri = videoUri;

      // 1. Compression (Native only, bypass for web)
      if (videoUri && Platform.OS !== 'web') {
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
      if (finalVideoUri) {
         const videoExt = finalVideoUri.split('.').pop()?.toLowerCase() || 'mp4';
         filePayloads.push({ id: 'vid', type: 'video', ext: videoExt, uri: finalVideoUri });
      }

      const validPhotos = photos.map((uri, i) => ({ uri, index: i })).filter(p => p.uri !== null);
      validPhotos.forEach((photo) => {
         const photoExt = photo.uri!.split('.').pop()?.toLowerCase() || 'jpeg';
         filePayloads.push({ id: `photo_${photo.index}`, type: 'photo', ext: photoExt, uri: photo.uri! });
      });

      // 3. Request AWS Presigned URLs
      console.log('Requesting Direct S3 Upload Tickets...');
      const presignRes = await api.post('/upload/presigned-urls', {
         files: filePayloads.map(f => ({ type: f.type, ext: f.ext }))
      });
      const uploadTickets = presignRes.data.data;

      // 4. HTTP PUT directly to S3
      console.log('Pushing binaries directly to S3...');
      const uploadResults = await Promise.all(filePayloads.map(async (file, index) => {
         const ticket = uploadTickets[index];
         
         // Fix: More robust file fetching for local URIs
         let blob;
         if (Platform.OS === 'web') {
           const response = await fetch(file.uri);
           blob = await response.blob();
         } else {
           // For native, fetch(uri) works but needs careful handling of file://
           const uri = Platform.OS === 'ios' && !file.uri.startsWith('file://') ? `file://${file.uri}` : file.uri;
           const response = await fetch(uri);
           blob = await response.blob();
         }

         const s3Res = await fetch(ticket.uploadUrl, {
           method: 'PUT',
           body: blob,
           headers: {
             'Content-Type': ticket.contentType
           }
         });

         if (!s3Res.ok) {
           throw new Error(`S3 Upload failed for ${file.type} with status ${s3Res.status}`);
         }
         await api.post(`/upload/${ticket.assetId}/complete`);

         return { type: file.type, url: ticket.fileUrl, id: file.id };
      }));

      const uploadedVideo = uploadResults.find(r => r.type === 'video')?.url || null;
      // Filter and sort photos by their original index to maintain order
      const uploadedPhotosSorted = uploadResults
        .filter(r => r.type === 'photo')
        .sort((a, b) => {
          const idxA = parseInt(a.id.split('_')[1]);
          const idxB = parseInt(b.id.split('_')[1]);
          return idxA - idxB;
        })
        .map(r => r.url);

      // 5. Save Final Web-Resolution Links
      console.log('Media uploaded. Saving URLs to profile...');
      const profileUpdateRes = await api.put('/profile', {
         profileVideoUrl: uploadedVideo,
         photos: uploadedPhotosSorted,
         avatarUrl: uploadedPhotosSorted[0] || null // Explicitly sync the first photo as avatar
      });

      if (profileUpdateRes.data?.success) {
        dispatch(updateUser(profileUpdateRes.data.data));
        
        console.log('Onboarding process successfully finalized.');
        dispatch(completeOnboarding());
      } else {
        throw new Error('Profile update failed on server');
      }
    } catch (error: any) {
      console.error("Upload failed", error?.response?.data || error);
      Alert.alert("Upload Failed", "There was an error uploading your media.");
    } finally {
      setIsUploading(false);
    }
  };

  const hasMinimumMedia = videoUri !== null && photos.some(p => p !== null);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.headerNav}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="arrow-left" size={28} color="#FFF" />
        </TouchableOpacity>
      </View>

      <Animated.ScrollView 
        style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Show your vibe</Text>
        <Text style={styles.subtitle}>
          Upload a short video and at least 1 photo to complete your profile.
        </Text>

        <View style={styles.gridContainer}>
          {/* Hero Video Slot */}
          <View style={styles.heroSlot}>
            {videoUri ? (
              <>
                <VideoPreview uri={videoUri} />
                <TouchableOpacity 
                  style={styles.removeBadge}
                  onPress={() => setVideoUri(null)}
                  hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <MaterialCommunityIcons name="close" size={16} color="#FFF" />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity 
                style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}
                onPress={pickVideo}
                activeOpacity={0.8}
              >
                <View style={styles.emptySlotContent}>
                  <View style={styles.iconCircle}>
                    <MaterialCommunityIcons name="video-plus" size={32} color="#000" />
                  </View>
                  <Text style={styles.slotText}>Vibe Check Video</Text>
                  <Text style={styles.slotSubtext}>Required (15-60s)</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* Photo Slots 2x3 Grid */}
          <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '700', marginTop: 16, marginBottom: 8, marginLeft: 4 }}>Photos</Text>
          <View style={styles.photoGrid}>
            {photos.map((photoUri, index) => (
              <View key={index} style={styles.photoSlot}>
                <TouchableOpacity 
                  style={{ width: '100%', height: '100%' }}
                  onPress={() => {
                    if (photoUri) {
                      if (Platform.OS === 'web') {
                        setWebCropImage({ uri: originalWebPhotos[index] || photoUri, index });
                      } else {
                        if (Platform.OS === 'ios') {
                          ActionSheetIOS.showActionSheetWithOptions({
                            options: ['Cancel', 'Replace Photo', 'Remove Photo'],
                            destructiveButtonIndex: 2,
                            cancelButtonIndex: 0,
                          }, (btnIndex) => {
                            if (btnIndex === 1) pickImage(index);
                            if (btnIndex === 2) removeImage(index);
                          });
                        } else {
                          Alert.alert(
                            "Photo Options",
                            "What would you like to do?",
                            [
                              { text: "Replace Photo", onPress: () => pickImage(index) },
                              { text: "Remove Photo", style: 'destructive', onPress: () => removeImage(index) },
                              { text: "Cancel", style: "cancel" }
                            ],
                            { cancelable: true }
                          );
                        }
                      }
                    } else {
                      pickImage(index);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  {photoUri ? (
                    <Image source={{ uri: photoUri }} style={styles.photoMedia} />
                  ) : (
                    <View style={styles.emptyPhotoContent}>
                      <MaterialCommunityIcons name="plus" size={24} color="#FFF" />
                    </View>
                  )}
                </TouchableOpacity>
                
                {photoUri && (
                  <TouchableOpacity 
                    style={styles.removeBadgeSmall}
                    onPress={() => removeImage(index)}
                    hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                  >
                    <MaterialCommunityIcons name="close" size={12} color="#FFF" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        </View>

      </Animated.ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.nextButton, (!hasMinimumMedia || isUploading) && styles.disabledButton]} 
          onPress={handleFinish}
          disabled={!hasMinimumMedia || isUploading}
        >
          {isUploading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color="#0F1115" style={{ marginRight: 8 }} />
              <Text style={styles.nextButtonText}>Uploading...</Text>
            </View>
          ) : (
            <Text style={styles.nextButtonText}>Done</Text>
          )}
        </TouchableOpacity>
      </View>

      <Modal transparent visible={showVideoModal} animationType="none">
        <View style={styles.modalOverlay}>
          <Animated.View style={[styles.modalContent, { opacity: modalOpacity, transform: [{ scale: modalScale }] }]}>
            <Text style={styles.modalTitle}>Upload Video</Text>
            <Text style={styles.modalSubtitle}>
              Choose how you want to upload your vibe check video.
            </Text>

            <TouchableOpacity 
              style={styles.modalPrimaryButton}
              onPress={() => { closeVideoModal(); setTimeout(() => handleVideoSelection('camera'), 300); }}
            >
              <MaterialCommunityIcons name="camera-outline" size={20} color="#000" style={{ marginRight: 8 }} />
              <Text style={styles.modalPrimaryText}>Shoot Video</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalSecondaryButton}
              onPress={() => { closeVideoModal(); setTimeout(() => handleVideoSelection('library'), 300); }}
            >
              <MaterialCommunityIcons name="folder-image" size={20} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.modalSecondaryText}>Choose from Library</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.modalCancelButton}
              onPress={closeVideoModal}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={showWebCamera} transparent animationType="slide">
        <WebCameraRecorder 
          onCancel={() => setShowWebCamera(false)} 
          onRecord={(uri) => {
            setVideoUri(uri);
            setShowWebCamera(false);
          }} 
        />
      </Modal>

      <Modal visible={showNativeCamera} transparent animationType="slide">
        <NativeCameraRecorder 
          onCancel={() => setShowNativeCamera(false)} 
          onRecord={(uri) => {
            setVideoUri(uri);
            setShowNativeCamera(false);
          }} 
        />
      </Modal>

      <Modal visible={!!webCropImage} transparent animationType="slide">
        {webCropImage && (
          <WebCropModal 
            imageUri={webCropImage.uri}
            onCancel={() => setWebCropImage(null)} 
            onCrop={(croppedUri) => {
              const newPhotos = [...photos];
              newPhotos[webCropImage.index] = croppedUri;
              setPhotos(newPhotos);
              setWebCropImage(null);
            }} 
          />
        )}
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F1115",
  },
  headerNav: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 10 : 45,
    height: Platform.OS === "ios" ? 60 : 90,
    justifyContent: "center",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 40,
    fontWeight: "800",
    color: "#FFF",
    lineHeight: 48,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    lineHeight: 24,
    marginBottom: 32,
  },
  gridContainer: {
    alignItems: 'center',
    paddingBottom: 40,
  },
  heroSlot: {
    width: '100%',
    aspectRatio: 3/4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.2)',
    borderStyle: 'dashed',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroMedia: {
    width: '100%',
    height: '100%',
  },
  emptySlotContent: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  slotText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  slotSubtext: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
  },
  removeBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoControlsOverlay: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  controlButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
  },
  photoSlot: {
    width: '31%',
    aspectRatio: 3/4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderStyle: 'dashed',
    overflow: 'hidden',
    marginBottom: 12,
  },
  photoMedia: {
    width: '100%',
    height: '100%',
  },
  emptyPhotoContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBadgeSmall: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    paddingTop: 10,
    backgroundColor: "#0F1115",
  },
  nextButton: {
    backgroundColor: "#FFF",
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  disabledButton: {
    opacity: 0.5,
  },
  nextButtonText: {
    color: "#0F1115",
    fontSize: 18,
    fontWeight: "700",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  modalContent: {
    backgroundColor: "#1C1C1E",
    width: "100%",
    borderRadius: 24,
    padding: 30,
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FFF",
    textAlign: "center",
    marginBottom: 10,
  },
  modalSubtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 30,
  },
  modalPrimaryButton: {
    backgroundColor: "#FFF",
    width: "100%",
    flexDirection: "row",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000",
  },
  modalSecondaryButton: {
    backgroundColor: "rgba(255,255,255,0.1)",
    width: "100%",
    flexDirection: "row",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalSecondaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFF",
  },
  modalCancelButton: {
    paddingVertical: 10,
    marginTop: 8,
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(255,255,255,0.4)",
  },
});
