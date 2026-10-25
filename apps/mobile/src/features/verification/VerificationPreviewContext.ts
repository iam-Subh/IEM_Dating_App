import { createContext, useContext } from 'react';
import type { VerificationStatus } from './useVerificationStatus';
import type { FaceStatus } from './RealPerson';

export const VerificationPreviewContext = createContext<{status: VerificationStatus; face: FaceStatus} | null>(null);
export function useVerificationPreview() {
  const sample = useContext(VerificationPreviewContext);
  return __DEV__ ? sample : null;
}
