import React, { useEffect, useState } from 'react';
import { BottomSheet, DurationPicker, SheetActions, SheetRow } from './BottomSheet';
import { AUTO_DELETE_PRESETS, MAX_TTL_SECONDS, MIN_CUSTOM_TTL_SECONDS, formatDuration } from '../conversationControls';

type Props = {
  visible: boolean;
  onClose: () => void;
  seconds: number | null;
  onChange: (seconds: number | null) => void;
};

/**
 * Telegram's "Auto-delete messages": Off, 1 day, 1 week, 1 month, or custom.
 *
 * The setting is shared by both people and applies to messages sent after it
 * changes, which is why the subtitle says "new messages".
 */
export function AutoDeleteSheet({ visible, onClose, seconds, onChange }: Props) {
  const [custom, setCustom] = useState(false);
  const [days, setDays] = useState(2);
  const [hours, setHours] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setCustom(false);
    // Open the custom picker on the current value when there is one.
    setDays(seconds ? Math.floor(seconds / 86400) : 2);
    setHours(seconds ? Math.floor((seconds % 86400) / 3600) : 0);
  }, [visible, seconds]);

  const isPreset = seconds !== null && AUTO_DELETE_PRESETS.some((preset) => preset.seconds === seconds);
  const customTotal = days * 86400 + hours * 3600;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Auto-delete messages"
      subtitle="Automatically delete new messages sent in this chat after a certain period of time."
    >
      {custom ? (
        <>
          <DurationPicker days={days} hours={hours} maxDays={366} onChange={(d, h) => { setDays(d); setHours(h); }} />
          <SheetActions
            onBack={() => setCustom(false)}
            onConfirm={() => onChange(Math.min(MAX_TTL_SECONDS, customTotal))}
            confirmLabel="Set"
            confirmDisabled={customTotal < MIN_CUSTOM_TTL_SECONDS}
          />
        </>
      ) : (
        <>
          <SheetRow icon="close-circle-outline" label="Off" checked={seconds === null} onPress={() => onChange(null)} />
          {AUTO_DELETE_PRESETS.map((preset) => (
            <SheetRow key={preset.seconds} icon="timer-outline" label={preset.label} checked={seconds === preset.seconds} onPress={() => onChange(preset.seconds)} />
          ))}
          <SheetRow
            icon="create-outline"
            label="Custom"
            detail={seconds !== null && !isPreset ? formatDuration(seconds) : undefined}
            checked={seconds !== null && !isPreset}
            onPress={() => setCustom(true)}
          />
        </>
      )}
    </BottomSheet>
  );
}
