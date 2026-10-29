import {InteractionManager, Platform} from 'react-native';

type Navigation = {
  isFocused: () => boolean;
  addListener: ((event: 'transitionEnd', callback: (event: {data: {closing: boolean}}) => void) => () => void)
    & ((event: 'focus', callback: () => void) => () => void);
};

/**
 * Longest wait for a signal before running anyway. A native form sheet closing
 * over a page (PhotoMediaOptions over PhotoUpload) does not always send that
 * page a transitionEnd on Android, and then Record and Choose from library
 * did nothing at all.
 */
const FALLBACK_MS = 700;

// Native stack transitions do not create InteractionManager handles.
// Runs `callback` once: after this page's own transition ends, after it is
// focused again (a sheet over it closed), or after FALLBACK_MS - whichever is first.
export function afterScreenTransition(navigation: Navigation, callback: () => void) {
  let active = true;
  let ran = false;
  let task: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;
  const prepare = () => {
    if (ran) return;
    task?.cancel();
    task = InteractionManager.runAfterInteractions(() => {
      if (!active || ran || !navigation.isFocused()) return;
      ran = true;
      callback();
    });
  };
  const stopTransition = navigation.addListener('transitionEnd', event => {
    if (!event.data.closing) prepare();
  });
  const stopFocus = navigation.addListener('focus', prepare);
  const fallback = setTimeout(prepare, FALLBACK_MS);
  if (Platform.OS === 'web') prepare();
  return () => {active = false; stopTransition(); stopFocus(); clearTimeout(fallback); task?.cancel();};
}
