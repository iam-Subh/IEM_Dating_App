// This state is transient. Returning users do not replay the onboarding transition.
export type ArrivalProfile = {id: string; name: string; age: number | null; primaryPhoto: string | null; campus: string | null; photoUri?: string | null};
type ArrivalSource = ArrivalProfile & {video?: string | null; videoPoster?: string | null; photos?: readonly string[]};
export type ArrivalFrame = {x: number; y: number; width: number; height: number};
type Arrival = {active: boolean; status: 'loading' | 'ready' | 'error'; replay?: boolean; profiles?: readonly ArrivalProfile[]; frame?: ArrivalFrame};
let state: Arrival = {active: false, status: 'loading'};
let retry: (() => void) | undefined;
const listeners = new Set<() => void>();
const publish = (next: Arrival) => {state = next; listeners.forEach(listener => listener());};
export const getDiscoveryArrival = () => state;
export const subscribeDiscoveryArrival = (listener: () => void) => {listeners.add(listener); return () => {listeners.delete(listener);};};
function arrivalProfiles(profiles: readonly ArrivalSource[]) {
  return profiles.slice(0, 3).map(({id, name, age, primaryPhoto, campus, photoUri, video, videoPoster, photos}) => ({
    id, name, age, primaryPhoto, campus,
    // The deck shows video first. Keep its poster through the reveal so the
    // image does not change when Discovery becomes visible.
    photoUri: photoUri ?? (video ? videoPoster || primaryPhoto : photos?.[0] || primaryPhoto),
  }));
}
export function startDiscoveryArrival(replay = false, profiles: readonly ArrivalSource[] = []) {
  retry = undefined;
  publish({active: true, status: replay ? 'ready' : 'loading', replay, profiles: arrivalProfiles(profiles)});
}
export function finishDiscoveryArrival() {retry = undefined; publish({active: false, status: 'loading'});}
export function updateDiscoveryArrival(status: Arrival['status'], onRetry: () => void, profiles?: readonly ArrivalSource[]) {
  if (!state.active || state.replay) return;
  retry = onRetry;
  const nextProfiles = profiles ? arrivalProfiles(profiles) : undefined;
  const changed = nextProfiles !== undefined && JSON.stringify(nextProfiles) !== JSON.stringify(state.profiles ?? []);
  if (state.status !== status || changed) publish({...state, status, ...(changed ? {profiles: nextProfiles} : {})});
}
export function setDiscoveryArrivalFrame(frame: ArrivalFrame) {
  if (!state.active || state.replay || !Object.values(frame).every(Number.isFinite) || frame.width <= 0 || frame.height <= 0) return;
  if (JSON.stringify(state.frame) !== JSON.stringify(frame)) publish({...state, frame});
}
export function retryDiscoveryArrival() {
  if (!state.active || !retry) return;
  publish({...state, status: 'loading'});
  retry();
}
