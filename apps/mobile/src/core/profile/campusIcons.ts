import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

/** Render campus fields with CampusFieldIcon so every screen uses the same icon family. */
export const CAMPUS_ICONS = Object.freeze({
  section: 'school-outline',
  college: 'business-outline',
  department: 'book-outline',
  degree: 'school-outline',
  graduationYear: 'calendar-outline',
  yearOfStudy: 'format-list-numbered',
  campus: 'location-outline',
  residency: 'home-outline',
  hosteller: 'bed-outline',
  dayScholar: 'bus-outline',
  attendanceMood: 'checkbox-outline',
  clubs: 'people-outline',
  hangoutSpots: 'cafe-outline',
  distancePreference: 'navigate-outline',
} as const satisfies Record<string, ComponentProps<typeof Ionicons>['name'] | 'format-list-numbered'>);
