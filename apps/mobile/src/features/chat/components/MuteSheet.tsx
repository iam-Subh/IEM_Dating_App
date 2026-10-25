import React, { useEffect, useState } from 'react';
import { BottomSheet, DurationPicker, SheetActions, SheetRow } from './BottomSheet';
import { MUTE_FOREVER_ISO, MUTE_PRESETS, formatMutedUntil, isMuted, isMutedForever } from '../conversationControls';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** The chat's current mute, or null for a multi-chat selection. */
  mutedUntil: string | null;
  onMute: (mutedUntil: string | null) => void;
};

/** Telegram's mute choices: fixed durations, a custom length, forever, and unmute. */
export function MuteSheet({ visible, onClose, mutedUntil, onMute }: Props) {
  const [custom, setCustom] = useState(false);
  const [days, setDays] = useState(0);
  const [hours, setHours] = useState(2);

  useEffect(() => {
    if (!visible) return;
    setCustom(false);
    setDays(0);
    setHours(2);
  }, [visible]);

  const until = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
  const muted = isMuted(mutedUntil);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={custom ? 'Mute for…' : 'Notifications'}
      subtitle={custom ? 'Choose how long this chat stays silent.' : formatMutedUntil(mutedUntil)}
    >
      {custom ? (
        <>
          <DurationPicker days={days} hours={hours} maxDays={365} onChange={(d, h) => { setDays(d); setHours(h); }} />
          <SheetActions
            onBack={() => setCustom(false)}
            onConfirm={() => onMute(until(days * 86400 + hours * 3600))}
            confirmLabel="Mute"
            confirmDisabled={days === 0 && hours === 0}
          />
        </>
      ) : (
        <>
          {MUTE_PRESETS.map((preset) => (
            <SheetRow key={preset.seconds} icon="notifications-off-outline" label={preset.label} onPress={() => onMute(until(preset.seconds))} />
          ))}
          <SheetRow icon="time-outline" label="Mute for…" onPress={() => setCustom(true)} />
          <SheetRow icon="volume-mute-outline" label="Mute forever" checked={isMutedForever(mutedUntil)} onPress={() => onMute(MUTE_FOREVER_ISO)} />
          {muted ? <SheetRow icon="notifications-outline" label="Unmute" onPress={() => onMute(null)} /> : null}
        </>
      )}
    </BottomSheet>
  );
}
