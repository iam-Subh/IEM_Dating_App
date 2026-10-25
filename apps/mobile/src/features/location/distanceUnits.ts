import { useSelector } from 'react-redux';
import type { RootState } from '../../store';

/**
 * Kilometres or miles (Settings > Distance units). Only how a distance reads:
 * everything is stored, compared and sent in km, so switching never changes
 * who you see. Card bands come from the server already in your unit.
 */

export type DistanceUnit = 'km' | 'mi';
const KM_PER_MI = 1.609344;

export const unitOf = (user: { distanceUnit?: string | null } | null | undefined): DistanceUnit =>
  user?.distanceUnit === 'mi' ? 'mi' : 'km';

export function useDistanceUnit(): DistanceUnit {
  return useSelector((state: RootState) => unitOf(state.auth.user as any));
}

export const kmToMi = (km: number) => km / KM_PER_MI;
export const miToKm = (mi: number) => mi * KM_PER_MI;

/** A distance setting in the chosen unit: "25 km", "16 mi". Never below 1. */
export function formatDistance(km: number, unit: DistanceUnit) {
  return unit === 'mi' ? `${Math.max(1, Math.round(kmToMi(km)))} mi` : `${Math.round(km)} km`;
}

export const unitName = (unit: DistanceUnit) => (unit === 'mi' ? 'miles' : 'kilometres');

/** The server's distance bands (utils/geo.ts distanceLabel), for demo cards that have no server. */
export function distanceBand(km: number, unit: DistanceUnit) {
  const bands: [number, string, string][] = [
    [5, 'Under 5 km away', 'Under 3 mi away'],
    [10, '5-10 km away', '3-6 mi away'],
    [25, '10-25 km away', '6-15 mi away'],
    [50, '25-50 km away', '15-30 mi away'],
    [100, '50-100 km away', '30-60 mi away'],
  ];
  const band = bands.find(([limit]) => km < limit);
  if (band) return unit === 'mi' ? band[2] : band[1];
  return unit === 'mi' ? 'Over 60 mi away' : 'Over 100 km away';
}
