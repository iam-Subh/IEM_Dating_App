/** Keep the newest row visible after both React layout and native anchoring. */
export function createChatAutoScroll(initialRequest = 0) {
  let request = initialRequest;
  let newestKey: string | null = null;
  let following = true;
  let settleUntil = 0;
  return {
    commit(key: string | null, nextRequest: number, hasNewer: boolean, now = Date.now()) {
      const requested = request !== nextRequest;
      const inserted = newestKey !== null && newestKey !== key;
      request = nextRequest;
      newestKey = key;
      if (requested || (inserted && following && !hasNewer)) {
        following = true;
        settleUntil = now + 350;
      }
      return following && !hasNewer;
    },
    scroll(offset: number, now = Date.now()) {
      // Native content anchoring can report the old offset during insertion.
      if (now >= settleUntil) following = Math.max(0, offset) <= 100;
    },
    drag() { following = false; settleUntil = 0; },
    isFollowing() { return following; },
  };
}
