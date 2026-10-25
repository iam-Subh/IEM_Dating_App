const messages = [
  {title: 'Setting up\nyour discovery', detail: 'Using your interests and preferences.'},
  {title: 'Using your\ninterests', detail: 'Look for something in common.'},
  {title: 'Using your\npreferences', detail: 'Choose who you want to meet.'},
] as const;

export function shuffleMessageIndex(progress: number) {
  'worklet';
  if (!Number.isFinite(progress)) return 0;
  return ((Math.floor(progress) % 3) + 3) % 3;
}

export function shuffleMessage(progress: number) {
  return messages[shuffleMessageIndex(progress)] ?? messages[0];
}
