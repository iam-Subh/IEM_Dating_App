import { FaceCheckIntroduction } from './FaceCheckIntroduction';
import { FaceCheckCamera } from './FaceCheckCamera';
import { FaceCheckFailure } from './FaceCheckFailure';
import { FaceCheckResult } from './FaceCheckResult';
import { MediaCorrectionPage } from './MediaCorrectionPage';
import type {MediaCorrection} from './mediaCorrectionModel';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, NativeModules, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { File as FileSystemFile, UploadType as FileSystemUploadType } from 'expo-file-system';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import { api } from '../../services/api';
import { store } from '../../store';
import { refreshVerificationStatus } from './useVerificationStatus';
import { raiseCaptureBrightness, restoreCaptureBrightness } from './captureBrightness';
import { openOnboardingReview } from '../auth/onboarding/onboardingNavigation';

/**
 * The real-person check (features/verification/PHOTO_VERIFICATION_PLAN.md):
 * a live selfie with three random actions, checked by our server against the
 * person's photos and video. No badge - the person is told "You're verified
 * as a real person".
 *
 * Google ML Kit, when this build has it, watches each action on the phone so
 * a missed blink is retried at once. The server checks every action again
 * from the face landmarks, so nothing here is trusted on its own - and a build
 * without ML Kit still works, just without the instant retry.
 */

type Step = 'straight' | 'blink' | 'left' | 'right' | 'smile';
type Upload = { step: Step; index: number; uploadUrl: string; contentType: string };
type Challenge = { challengeId: string; actions: Step[]; framesPerStep: number; uploads: Upload[]; attemptsLeft: number };
type Phase = 'intro' | 'camera' | 'sending' | 'result';
type MediaItem = { url: string; kind: 'photo' | 'video'; main: boolean; status: 'match' | 'unsure' | 'mismatch' | 'no_face' };
type Result = { status: string; reason: string | null; message?: string; items?: MediaItem[]; failedStep?: Step; errorCode?: string };

/** One row per photo and the video: what was checked, and how it came out. */
function itemLine(item: MediaItem, photoNumber: number) {
  const name = item.kind === 'video' ? 'Your video' : item.main ? 'Main photo' : `Photo ${photoNumber}`;
  if (item.status === 'match') return { name, text: 'Matches you', ok: true as const };
  if (item.status === 'unsure') return { name, text: 'Being checked by our team', ok: null };
  if (item.status === 'no_face') {
    // A photo without a face is fine; the main photo and the video must show them.
    if (item.kind === 'photo' && !item.main) return { name, text: 'No face - that\'s fine', ok: true as const };
    return { name, text: item.kind === 'video' ? "We can't see you in it" : 'No face - it must show you', ok: false as const };
  }
  return { name, text: item.kind === 'video' ? "Doesn't show you - replace it" : "Doesn't look like you - replace it", ok: false as const };
}

const SAY: Record<Step, { title: string; hint: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  straight: { title: 'Look straight\nat the camera', hint: 'Look ahead and hold still.', icon: 'scan-outline' },
  blink: { title: 'Close your eyes', hint: 'Keep them closed until the vibration.', icon: 'eye-off-outline' },
  left: { title: 'Turn your head\nto your left', hint: 'Turn slowly, as far as is comfortable.', icon: 'arrow-back-outline' },
  right: { title: 'Turn your head\nto your right', hint: 'Turn slowly, as far as is comfortable.', icon: 'arrow-forward-outline' },
  // Either kind counts: the server checks a wider mouth or lifted corners.
  smile: { title: 'Smile', hint: 'With or without teeth - and hold it', icon: 'happy-outline' },
};

/** ML Kit face detection - only when this build has the native module. */
type MlFace = { rotationY: number; smilingProbability?: number; leftEyeOpenProbability?: number; rightEyeOpenProbability?: number };
const mlKit: null | { detect: (uri: string, options: object) => Promise<MlFace[]> } = NativeModules.FaceDetection
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ? require('@react-native-ml-kit/face-detection').default
  : null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How open both eyes look, 0 to 1; undefined when ML Kit could not say. */
const eyesOpen = (face: MlFace) => face.leftEyeOpenProbability === undefined || face.rightEyeOpenProbability === undefined
  ? undefined : (face.leftEyeOpenProbability + face.rightEyeOpenProbability) / 2;
/** Closed: under this, or under half of how open their own eyes looked when they looked straight. */
const EYES_CLOSED = 0.4;
const CLOSED_SHARE = 0.5;

/** Is this frame doing what the step asks? Undefined: can't tell on this phone. */
async function looksRight(step: Step, uri: string, straightYaw: number | null, straightEyes: number | null): Promise<boolean | undefined> {
  if (!mlKit) return undefined;
  try {
    // Closed eyes are harder to read, so that step gets the slower, careful mode.
    const faces = await mlKit.detect(uri, { classificationMode: 'all', performanceMode: step === 'blink' ? 'accurate' : 'fast' });
    // With the eyes shut ML Kit often loses the face or can't score the eyes.
    // That is "can't tell", not "eyes open": the server checks the frame itself.
    if (step === 'blink') {
      const eyes = faces.length === 1 ? eyesOpen(faces[0]) : undefined;
      if (__DEV__) console.log('[FACE] closed eyes', JSON.stringify({ faces: faces.length, eyes, straightEyes }));
      if (eyes === undefined) return undefined;
      return eyes < EYES_CLOSED || (straightEyes !== null && eyes < straightEyes * CLOSED_SHARE);
    }
    if (faces.length !== 1) return false;
    const face = faces[0];
    const eyes = eyesOpen(face) ?? 1;
    switch (step) {
      case 'straight': return Math.abs(face.rotationY) < 12 && eyes > 0.5;
      // Any clear turn, all the way to a full side view.
      case 'left': case 'right':
        return Math.abs(face.rotationY - (straightYaw ?? 0)) > 15;
      case 'smile': return (face.smilingProbability ?? 0) > 0.7;
    }
  } catch {
    return undefined;
  }
}

// The check reads every photo and the video against the selfie, which can
// outlast the app's usual 30-second wait (a passed check once showed
// "couldn't finish" at 33 s).
const SUBMIT_TIMEOUT_MS = 120_000;
const RESULT_WAIT_MS = 90_000;
const RESULT_POLL_MS = 3_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the check and returns its result. If the answer is lost - a slow
 * check or a Wi-Fi drop, with no reply from the server - it asks the server
 * how the check ended instead of failing a check that may have passed, and
 * sends it again if it never arrived.
 */
async function submitCheck(challengeId: string, active: () => boolean): Promise<Result | null> {
  const send = async () => (await api.post('/verification/face/submit', {challengeId}, {timeout: SUBMIT_TIMEOUT_MS})).data.data as Result;
  let lost: unknown;
  try {
    return await send();
  } catch (error: any) {
    if (error?.response) throw error; // A real answer, such as expired: show it.
    lost = error;
  }
  const deadline = Date.now() + RESULT_WAIT_MS;
  let resent = false;
  while (Date.now() < deadline) {
    if (!active()) return null;
    try {
      const answer = (await api.get(`/verification/face/challenge/${challengeId}`)).data.data as
        {state: 'done'; result: Result} | {state: 'checking' | 'not_submitted' | 'expired'};
      if (answer.state === 'done') return answer.result;
      if (answer.state === 'expired') break;
      if (answer.state === 'not_submitted' && !resent) {
        resent = true;
        try { return await send(); } catch (error: any) { if (error?.response) throw error; }
      }
    } catch (error: any) {
      if (error?.response) throw error;
      // Still offline: keep asking until the deadline.
    }
    await pause(RESULT_POLL_MS);
  }
  throw lost;
}

export function RealPersonCheckScreen() {
  const navigation = useNavigation<any>();
  // Straight after adding photos in onboarding: "Do it later" rather than "Not now".
  const params = useRoute<any>().params;
  const onboarding = !!params?.onboarding;
  const returnToReview = !!params?.returnToReview;
  const permission = useCameraPermission();
  const device = useCameraDevice('front');
  const photoOutput = usePhotoOutput({ qualityPrioritization: 'speed', quality: 0.8 });
  const outputs = useMemo(() => [photoOutput], [photoOutput]);
  // After the person replaces media the check flagged, the server re-checks it
  // against their face key. That outcome opens here: no second selfie.
  const recheck: Result | undefined = params?.recheck;
  const [phase, setPhase] = useState<Phase>(recheck ? 'result' : 'intro');
  const [step, setStep] = useState<Step>('straight');
  const [stepNumber, setStepNumber] = useState(1);
  const [stepTotal, setStepTotal] = useState(4);
  const [completed, setCompleted] = useState(0);
  const [started, setStarted] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<Result | null>(recheck ?? null);
  const [cameraReady, setCameraReady] = useState(false);
  const session = useRef(0);
  const runningSession = useRef<number | null>(null);
  /**
   * Onboarding returns to profile review. A check opened from Profile returns
   * to its previous screen, or the app's required screen if no history exists.
   */
  const rootScreen = () => {
    const auth = store.getState().auth;
    return !auth.isAuthenticated && auth.nextRequiredStep === 'discoveryPreferences' ? 'RequiredDiscoveryPreferences' : 'Main';
  };
  const leave = useCallback(() => {
    session.current += 1;
    if (returnToReview) { openOnboardingReview(navigation); return; }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: rootScreen() }] });
  }, [navigation, returnToReview]);
  const editMedia = useCallback((item?: MediaCorrection) => {
    if (onboarding || returnToReview) {
      navigation.replace('PhotoUpload', {correctionTarget: item ? {kind: item.kind, url: item.url} : undefined});
      return;
    }
    const params = {section: item?.kind === 'video' ? 'video' : 'photos'};
    if (navigation.canGoBack()) navigation.replace('EditProfile', params);
    else navigation.reset({ index: 1, routes: [{ name: rootScreen() }, { name: 'EditProfile', params }] });
  }, [navigation, onboarding, returnToReview]);
  useEffect(() => () => { session.current += 1; }, []);
  // Bright from "I'm ready" until the steps end: sending, a result, or leaving.
  useEffect(() => { if (phase !== 'camera') void restoreCaptureBrightness(); }, [phase]);
  useEffect(() => () => { void restoreCaptureBrightness(); }, []);

  /** One small, upright JPEG of the camera, as a file. */
  const capture = useCallback(async () => {
    const photo = await photoOutput.capturePhoto({ flashMode: 'off', enableShutterSound: false }, {});
    const path = await photo.saveToTemporaryFileAsync();
    (photo as unknown as { dispose?: () => void }).dispose?.();
    const uri = path.startsWith('file://') ? path : `file://${path}`;
    const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 720 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    return small.uri;
  }, [photoOutput]);

  const run = useCallback(async () => {
    if (phase !== 'camera' || !cameraReady || runningSession.current === session.current) return;
    const currentSession = session.current;
    runningSession.current = currentSession;
    void raiseCaptureBrightness();
    const active = () => session.current === currentSession;
    const temporary = new Set<string>();
    let stage: 'capture' | 'upload' | 'submit' = 'capture';
    setStarted(true);
    try {
      let challenge: Challenge;
      try {
        challenge = (await api.post('/verification/face/challenge')).data.data;
      } catch (error: any) {
        if (active()) {
          setResult({status: 'failed', reason: 'connection', errorCode: error?.response?.data?.code,
            message: error?.response?.data?.message});
          setPhase('result');
        }
        return;
      }
      if (!active()) return;
      const steps: Step[] = ['straight', ...challenge.actions];
      setStepTotal(steps.length);
      const frames: { step: Step; index: number; uri: string }[] = [];
      let straightYaw: number | null = null;
      let straightEyes: number | null = null;
      for (const [number, current] of steps.entries()) {
        if (!active()) return;
        setStep(current);
        setStepNumber(number + 1);
        setCaptured(false);
        setConfirmed(false);
        let done = false;
        for (let attempt = 0; attempt < 3 && !done; attempt++) {
          setNote(attempt ? "Let's try that again." : '');
          // A turn's first frame comes early, mid-turn, while both eyes still
          // show; the next one once they have turned further.
          const turn = current === 'left' || current === 'right';
          // Eyes still shut on a retry: no time is needed to read the step again.
          await wait(current === 'straight' ? 1500 : turn ? 900 : current === 'blink' && attempt ? 400 : 2200);
          if (!active()) return;
          const taken: string[] = [];
          for (let index = 0; index < challenge.framesPerStep; index++) {
            await wait(turn ? (index === 0 ? 300 : 900) : index === 0 ? 600 : 450);
            if (!active()) return;
            const uri = await capture();
            temporary.add(uri);
            if (!active()) return;
            taken.push(uri);
          }
          const checks = await Promise.all(taken.map((uri) => looksRight(current, uri, straightYaw, straightEyes)));
          if (!active()) return;
          // Local checks guide retries. The server verifies every frame.
          done = checks.every((value) => value === undefined) || checks.some((value) => value === true);
          setConfirmed(checks.some((value) => value === true));
          if (done) {
            taken.forEach((uri, index) => frames.push({step: current, index, uri}));
            if (current === 'straight' && mlKit) {
              const faces = await mlKit.detect(taken[0], {classificationMode: 'all', performanceMode: 'fast'}).catch(() => [] as MlFace[]);
              if (!active()) return;
              straightYaw = faces[0]?.rotationY ?? null;
              straightEyes = faces[0] ? eyesOpen(faces[0]) ?? null : null;
            }
          }
          // The vibration means "done, you can stop". With their eyes shut they
          // can't read "try again", so a missed closed-eyes frame is simply
          // taken again while they keep them closed - no buzz until the end.
          if (done || current !== 'blink' || attempt === 2) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        }
        if (!done) {
          setResult({status: 'failed', reason: 'liveness', failedStep: current, message: "We couldn't see that step. Find good light, keep your face in the oval, and try again."});
          setPhase('result');
          return;
        }
        setCaptured(true);
        setCompleted(number + 1);
        await wait(500);
        if (!active()) return;
      }
      setCaptured(false);
      setPhase('sending');
      stage = 'upload';
      for (const frame of frames) {
        if (!active()) return;
        const slot = challenge.uploads.find((item) => item.step === frame.step && item.index === frame.index);
        if (!slot) continue;
        const upload = await new FileSystemFile(frame.uri).upload(slot.uploadUrl, {
          httpMethod: 'PUT', uploadType: FileSystemUploadType.BINARY_CONTENT, mimeType: slot.contentType,
          headers: {'Content-Type': slot.contentType},
        });
        if (upload.status < 200 || upload.status >= 300) throw new Error('upload');
      }
      if (!active()) return;
      stage = 'submit';
      const outcome = await submitCheck(challenge.challengeId, active);
      if (!active() || !outcome) return;
      setResult(outcome);
      void refreshVerificationStatus();
      setPhase('result');
    } catch (error: any) {
      if (active()) {
        setResult({status: 'failed', reason: stage, errorCode: error?.response?.data?.code, message: error?.response?.data?.message});
        setPhase('result');
      }
    } finally {
      temporary.forEach((uri) => {try {new FileSystemFile(uri).delete();} catch { /* temporary */ }});
    }
  }, [capture, cameraReady, phase]);

  const start = async () => {
    const openingSession = session.current;
    if (!permission.hasPermission && !(await permission.requestPermission())) {
      if (session.current !== openingSession) return;
      Alert.alert('Camera access needed', 'Allow camera access for the live selfie check.', [{text: 'Cancel', style: 'cancel'}, {text: 'Open settings', onPress: () => void Linking.openSettings()}]);
      return;
    }
    if (session.current !== openingSession) return;
    session.current += 1;
    setResult(null);
    setCameraReady(false);
    setStarted(false);
    setCaptured(false);
    setConfirmed(false);
    setCompleted(0);
    setStep('straight');
    setStepNumber(1);
    setStepTotal(4);
    setNote('');
    setPhase('camera');
  };

  // -------------------------------------------------------------------------
  if (phase === 'intro') {
    return <FaceCheckIntroduction onboarding={onboarding} onBack={leave} onStart={start}/>;
  }

  if (phase === 'result' && result) {
    if (result.status === 'verified' || result.status === 'pending_review') {
      let photo = 0;
      const rows = (result.items ?? []).map(item => {
        if (item.kind === 'photo') photo += 1;
        return {...item, ...itemLine(item, photo)};
      });
      return <FaceCheckResult status={result.status} rows={rows} onContinue={leave} onboarding={onboarding || returnToReview}/>;
    }
    if (result.status === 'needs_fix') {
      return <MediaCorrectionPage items={result.items ?? []} reason={result.reason} onEdit={editMedia} onClose={leave}/>;
    }
    return <FaceCheckFailure result={result} onboarding={onboarding} onRetry={start} onClose={leave}/>;
  }

  return <FaceCheckCamera
    title={SAY[step].title}
    hint={SAY[step].hint} icon={SAY[step].icon} step={stepNumber} total={stepTotal} completed={completed}
    ready={cameraReady} started={started} captured={captured} confirmed={confirmed} sending={phase === 'sending'} note={note}
    onReady={() => void run()} onClose={leave}
    preview={device ? <Camera style={StyleSheet.absoluteFill} device={device} isActive={phase === 'camera'} outputs={outputs}
      onStarted={() => setCameraReady(true)}
      onError={() => {
        session.current += 1;
        setResult({status: 'failed', reason: 'camera', message: "The camera didn't start. Close other camera apps and try again."});
        setPhase('result');
      }}/>
      : <ActivityIndicator color="#FFF"/>}
  />;
}

