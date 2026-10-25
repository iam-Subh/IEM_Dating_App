export type FaceCheckFailure = {
  reason: string | null;
  message?: string;
  failedStep?: string;
  errorCode?: string;
};

type Tip = {icon: 'sunny-outline' | 'scan-outline' | 'phone-portrait-outline' | 'wifi-outline' | 'time-outline' | 'camera-outline' | 'person-outline'; text: string};
export type FailureContent = {title: string; explanation: string; tips: Tip[]; settings: boolean};

const faceTips: Tip[] = [
  {icon: 'sunny-outline', text: 'Face a light source. Keep your face clear.'},
  {icon: 'scan-outline', text: 'Keep your face inside the oval.'},
  {icon: 'phone-portrait-outline', text: 'Hold each pose until the vibration.'},
];

export function faceCheckFailureContent(result: FaceCheckFailure): FailureContent {
  const reason = result.reason ?? '';
  if (result.errorCode === 'FACE_SERVICE_UNAVAILABLE' || result.errorCode === 'FACE_STORAGE_UNAVAILABLE' || reason === 'service') {
    return {title: 'The check\ncouldn’t finish.', explanation: 'Face checking is temporarily unavailable.', settings: false, tips: [
      {icon: 'time-outline', text: 'Wait a little before you try again.'},
      {icon: 'camera-outline', text: 'Take a new selfie when the service is available.'},
    ]};
  }
  if (result.errorCode === 'FACE_CHALLENGE_EXPIRED' || result.errorCode === 'FACE_CHALLENGE_UNAVAILABLE') {
    return {title: 'Start a\nnew face check.', explanation: 'This face check expired or is no longer available.', settings: false, tips: [
      {icon: 'camera-outline', text: 'Tap Try again to start a new check.'},
      {icon: 'phone-portrait-outline', text: 'Keep the app open through all four prompts.'},
    ]};
  }
  if (result.errorCode === 'FACE_ATTEMPTS_LIMIT') {
    return {title: 'Try again\ntomorrow.', explanation: 'You have used today’s face check attempts.', settings: false, tips: [
      {icon: 'time-outline', text: 'Return tomorrow for another attempt.'},
      {icon: 'sunny-outline', text: 'Choose a well-lit place for your next check.'},
    ]};
  }
  if (reason === 'camera' || reason === 'capture') {
    return {title: 'The camera\ncouldn’t finish.', explanation: reason === 'camera' ? 'The camera could not start.' : 'The camera could not capture a selfie frame.', settings: true, tips: [
      {icon: 'camera-outline', text: 'Close other apps that use the camera.'},
      {icon: 'phone-portrait-outline', text: 'Check camera access in your phone settings.'},
      {icon: 'scan-outline', text: 'Return here and start the check again.'},
    ]};
  }
  if (reason === 'upload' || reason === 'no_snapshots') {
    return {title: 'Your selfie\ndidn’t send.', explanation: 'Your selfie did not finish uploading. We could not check it.', settings: false, tips: [
      {icon: 'wifi-outline', text: 'Check your Wi-Fi or mobile data connection.'},
      {icon: 'phone-portrait-outline', text: 'Keep the app open while the selfie uploads.'},
      {icon: 'camera-outline', text: 'Try again to take and send a new selfie.'},
    ]};
  }
  if (reason === 'connection' || reason === 'submit') {
    return {title: 'The check\ncouldn’t finish.', explanation: 'We could not get a result from the verification service.', settings: false, tips: [
      {icon: 'wifi-outline', text: 'Check your Wi-Fi or mobile data connection.'},
      {icon: 'time-outline', text: 'If your connection works, try again later.'},
    ]};
  }
  if (reason === 'error') {
    return {title: 'The check\ncouldn’t finish.', explanation: 'The check ended before we could get a result. A specific failure reason was not reported.', settings: false, tips: [
      {icon: 'wifi-outline', text: 'Check your connection before you retry.'},
      {icon: 'phone-portrait-outline', text: 'Keep the app open during the next check.'},
      {icon: 'time-outline', text: 'If the check fails again, try again later.'},
    ]};
  }
  if (reason === 'no_face') {
    return {title: 'We couldn’t\nconfirm it.', explanation: 'We could not detect one clear face in enough of the selfie frames.', settings: false, tips: [
      {icon: 'person-outline', text: 'Make sure only your face is in view.'},
      ...faceTips.slice(0, 2),
    ]};
  }
  if (reason === 'not_one_person') {
    return {title: 'We couldn’t\nconfirm it.', explanation: 'We could not confirm the same face throughout the check.', settings: false, tips: [
      {icon: 'person-outline', text: 'Keep only your face in view for every prompt.'},
      {icon: 'sunny-outline', text: 'Use steady light throughout the check.'},
      {icon: 'phone-portrait-outline', text: 'Hold the phone steady as you follow the prompts.'},
    ]};
  }
  if (reason.startsWith('liveness')) {
    const steps = result.failedStep ? [result.failedStep] : reason.split(':')[1]?.split(',') ?? [];
    const specific = steps.length === 1 ? {
      straight: 'We could not confirm that you faced the camera directly.',
      blink: 'We could not confirm that your eyes were closed.',
      left: 'We could not confirm the head turn to your left.',
      right: 'We could not confirm the head turn to your right.',
      smile: 'We could not confirm the smile.',
      same_side: 'We could not confirm head turns in opposite directions.',
    }[steps[0]] : undefined;
    return {title: 'We couldn’t\nconfirm it.', explanation: specific ?? 'We could not confirm one or more of the face movements.', settings: false,
      tips: steps.includes('same_side') ? [faceTips[0], {icon: 'scan-outline', text: 'Turn in opposite directions for the two head-turn prompts.'}, faceTips[2]] : faceTips};
  }
  return {title: 'We couldn’t\nconfirm it.', explanation: result.message ?? 'The check did not return a confirmed result. The exact cause is unavailable.', settings: false, tips: [
    {icon: 'wifi-outline', text: 'Check your connection before you retry.'},
    ...faceTips.slice(0, 2),
  ]};
}
