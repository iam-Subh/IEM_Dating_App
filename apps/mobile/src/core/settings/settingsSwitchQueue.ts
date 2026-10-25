export type SettingsSwitchField = 'searchDiscoverable' | 'notifyLikes' | 'showOnlineStatus' | 'showRecentlyActive' | 'searchByUnverified';
export type SettingsSwitchValues = Record<SettingsSwitchField, boolean>;
const fields: SettingsSwitchField[] = ['searchDiscoverable', 'notifyLikes', 'showOnlineStatus', 'showRecentlyActive', 'searchByUnverified'];

/** Keep the displayed choice stable while ordered requests finish. */
export function createSettingsSwitchQueue(initial: SettingsSwitchValues, callbacks: {
  save: (field: SettingsSwitchField, value: boolean) => Promise<boolean>;
  onChange: (values: SettingsSwitchValues) => void;
  onConfirm: (field: SettingsSwitchField, value: boolean) => void;
  onError: (field: SettingsSwitchField, error: unknown) => void;
}) {
  let desired = { ...initial };
  const confirmed = { ...initial };
  const revision = { searchDiscoverable: 0, notifyLikes: 0, showOnlineStatus: 0, showRecentlyActive: 0, searchByUnverified: 0 };
  const pending = new Set<SettingsSwitchField>();
  let queue = Promise.resolve();
  const emit = () => callbacks.onChange({ ...desired });
  return {
    sync(values: SettingsSwitchValues) {
      let changed = false;
      for (const field of fields) {
        if (pending.has(field)) continue;
        confirmed[field] = values[field];
        if (desired[field] !== values[field]) { desired[field] = values[field]; changed = true; }
      }
      if (changed) emit();
    },
    change(field: SettingsSwitchField, value: boolean) {
      if (desired[field] === value) return queue;
      desired = { ...desired, [field]: value };
      const version = ++revision[field];
      pending.add(field);
      emit();
      queue = queue.then(async () => {
        try {
          const saved = await callbacks.save(field, value);
          confirmed[field] = saved;
          callbacks.onConfirm(field, saved);
          if (revision[field] === version && desired[field] !== saved) { desired[field] = saved; emit(); }
        } catch (error) {
          if (revision[field] === version) {
            desired[field] = confirmed[field];
            emit();
            callbacks.onError(field, error);
          }
        } finally {
          if (revision[field] === version) pending.delete(field);
        }
      });
      return queue;
    },
  };
}
