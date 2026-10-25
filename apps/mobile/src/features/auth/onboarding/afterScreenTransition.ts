import {InteractionManager, Platform} from 'react-native';

type Navigation = {
  isFocused: () => boolean;
  addListener: (event: 'transitionEnd', callback: (event: {data: {closing: boolean}}) => void) => () => void;
};

// Native stack transitions do not create InteractionManager handles.
export function afterScreenTransition(navigation: Navigation, callback: () => void) {
  let active = true;
  let task: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;
  const prepare = () => {
    task?.cancel();
    task = InteractionManager.runAfterInteractions(() => {
      if (active && navigation.isFocused()) callback();
    });
  };
  const unsubscribe = navigation.addListener('transitionEnd', event => {
    if (!event.data.closing) prepare();
  });
  if (Platform.OS === 'web') prepare();
  return () => {active = false; unsubscribe(); task?.cancel();};
}
