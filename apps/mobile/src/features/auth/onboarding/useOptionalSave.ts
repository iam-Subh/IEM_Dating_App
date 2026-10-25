import {useRef, useState} from 'react';
import {useOnboarding} from './useOnboarding';
import {nextProfileStep} from './onboardingFlow';

export function useOptionalSave() {
  const o = useOnboarding();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const saving = useRef(false);
  const nextScreen = nextProfileStep(o.route.name) ?? 'OnboardingReview';
  const save = async (fields: Record<string, any>) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {await o.save(fields); o.next(nextScreen);}
    catch {setError('Could not save your answers. Try again.');}
    finally {saving.current = false; setBusy(false);}
  };
  const skip = o.editing ? undefined : () => {if (!saving.current) o.next(nextScreen);};
  return {...o, busy, error, skip, action: o.editing ? 'Save' : 'Continue', saveOptional: save};
}
