import { useEffect, useState } from 'react';
import type { ComposerDraft } from './composerDraft';

/** Link previews and draft storage do not need a chat-screen render per key. */
export function useComposerDraftText(draft: ComposerDraft) {
  const [text, setText] = useState(draft.getSnapshot);
  useEffect(() => {
    setText(draft.getSnapshot());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = draft.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setText(draft.getSnapshot()), 120);
    });
    return () => { clearTimeout(timer); unsubscribe(); };
  }, [draft]);
  return text;
}
