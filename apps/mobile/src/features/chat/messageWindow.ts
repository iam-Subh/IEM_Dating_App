/** Reject responses from a replaced message window or an unmounted screen. */
export function createMessageWindow() {
  let generation = 0;
  return {
    capture: () => generation,
    invalidate: () => { generation += 1; },
    isCurrent: (ticket: number) => ticket === generation,
  };
}
