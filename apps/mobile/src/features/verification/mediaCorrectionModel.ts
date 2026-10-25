export type CheckedMedia = {
  url: string;
  kind: 'photo' | 'video';
  main: boolean;
  status: 'match' | 'unsure' | 'mismatch' | 'no_face';
};

export type MediaCorrection = {
  url: string;
  kind: 'photo' | 'video';
  main: boolean;
  name: string;
  reason: string;
  hint: string;
  action: string;
};

export function mediaCorrections(items: CheckedMedia[], reason: string | null) {
  const corrections: MediaCorrection[] = [];
  let photo = 0;
  for (const item of items) {
    if (item.kind === 'photo') photo++;
    const name = item.kind === 'video' ? 'Profile video' : item.main ? 'Main photo' : `Photo ${photo}`;
    if (item.status !== 'mismatch' && !(item.status === 'no_face' && (item.main || item.kind === 'video'))) continue;
    const video = item.kind === 'video';
    corrections.push({...item, name,
      reason: item.status === 'no_face' ? 'We could not find a clear face.' : 'We could not match this to your live selfie.',
      hint: video ? 'Record yourself facing the camera in good light.' : item.main
        ? 'Use a clear photo of yourself with your face visible.'
        : 'Replace this photo, or remove it in photo options.',
      action: video ? 'Edit video' : item.main ? 'Edit main photo' : 'Edit photo',
    });
  }
  // A missing main photo is also a correction, but has no image to display.
  if (reason === 'main_photo' && !items.some(item => item.kind === 'photo' && item.main)) {
    corrections.unshift({url: '', kind: 'photo', main: true, name: 'Main photo', reason: 'Your main photo is missing.',
      hint: 'Add a clear photo of yourself with your face visible.', action: 'Add main photo'});
  }
  return {corrections,
    confirmed: items.filter(item => item.status === 'match' || (item.status === 'no_face' && item.kind === 'photo' && !item.main)).length,
    pending: items.filter(item => item.status === 'unsure').length,
  };
}
