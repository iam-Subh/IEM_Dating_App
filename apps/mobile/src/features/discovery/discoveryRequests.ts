/** A refresh replaces any older request. Pagination never overlaps a request. */
export function createDiscoveryRequests() {
  let generation = 0;
  let active: {id: number; controller: AbortController} | null = null;
  return {
    begin(restart: boolean) {
      if (!restart && active) return null;
      active?.controller.abort();
      const request = {id: ++generation, controller: new AbortController()};
      active = request;
      return {
        id: request.id,
        signal: request.controller.signal,
        isLatest: () => request.id === generation && !request.controller.signal.aborted,
        finish() {if (active === request) active = null;},
      };
    },
    cancel() {generation++; active?.controller.abort(); active = null;},
  };
}
