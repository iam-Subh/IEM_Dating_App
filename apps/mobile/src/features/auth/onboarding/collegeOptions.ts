import {api} from '../../../services/api';

export type CollegeOption = {id: string; name: string; code?: string; city?: string; campusList?: {id: string; name: string}[]};
let cached: CollegeOption[] = [];
let loadedAt = 0;
let pending: Promise<CollegeOption[]> | null = null;
export const cachedCollegeOptions = () => cached;

/** Public college options can be prepared before the editor opens. */
export function loadCollegeOptions(force = false): Promise<CollegeOption[]> {
  if (!force && cached.length && Date.now() - loadedAt < 5 * 60_000) return Promise.resolve(cached);
  pending ??= api.get('/verification/institutions').then(response => {
    cached = (response.data.data as CollegeOption[]).filter(item => ['IEM-KOLKATA', 'UEM-KOLKATA'].includes(item.code ?? ''));
    loadedAt = Date.now();
    return cached;
  }).finally(() => {pending = null;});
  return pending;
}
