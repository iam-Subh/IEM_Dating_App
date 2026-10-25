import React, { memo, useCallback } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {TapChoice} from '../features/auth/onboarding/ConnectionDesign';
import { PROFILE_CLUBS } from '../core/profile/profileOptions';
import { MAX_SELECTED_CLUBS, toggleClubSelection } from '../core/profile/clubSelection';
import {clubArtwork as illustrations} from '../core/profile/clubArtwork';

const ClubCard = memo(function ClubCard({ club, checked, disabled, onToggle, lightCards }: {
  club: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (club: string) => void;
  lightCards: boolean;
}) {
  return <TapChoice accessibilityRole="checkbox" accessibilityLabel={club}
    accessibilityState={{ checked, disabled }} disabled={disabled}
    onPress={() => onToggle(club)}
    style={[styles.card, lightCards && styles.lightCard, checked && styles.selectedCard, disabled && !checked && styles.unavailable]}>
    <Image source={Platform.OS === 'web' && typeof illustrations[club] === 'string' ? {uri: illustrations[club] as unknown as string} : illustrations[club]} resizeMode="contain" resizeMethod="resize" fadeDuration={0} style={styles.image} accessible={false} />
    <Text style={[styles.name, checked && styles.selectedName]}>{club}</Text>
    {checked && <View pointerEvents="none" style={styles.check}><Ionicons accessible={false} name="checkmark" size={14} color="#F3C1CA" /></View>}
  </TapChoice>;
});

export function ClubSelectionGrid({ selected, onChange, disabled = false, lightCards = false, shouldIgnorePress, compactHeading = false }: {
  selected: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  disabled?: boolean;
  lightCards?: boolean;
  shouldIgnorePress?: () => boolean;
  compactHeading?: boolean;
}) {
  const full = selected.length >= MAX_SELECTED_CLUBS;
  const toggle = useCallback((club: string) => {
    if (shouldIgnorePress?.()) return;
    onChange(current => toggleClubSelection(current, club));
  }, [onChange, shouldIgnorePress]);
  return <View style={styles.section}>
    <View style={styles.heading}>
      <Text style={compactHeading ? styles.hint : styles.title}>{compactHeading ? (full ? 'Remove one to add another.' : 'Choose up to 5 clubs.') : 'IEM clubs'}</Text>
      <View style={styles.counter}><Text style={styles.counterText} accessibilityLiveRegion="polite">
        {selected.length} / {MAX_SELECTED_CLUBS} selected
      </Text></View>
    </View>
    {!compactHeading && <Text style={styles.hint}>{full ? 'Remove one club to select another.' : 'Choose up to five clubs.'}</Text>}
    <View style={styles.grid}>
      {PROFILE_CLUBS.map(club => {
        const checked = selected.includes(club);
        const unavailable = disabled || (full && !checked);
        return <ClubCard key={club} club={club} checked={checked} disabled={unavailable} onToggle={toggle} lightCards={lightCards} />;
      })}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: '#FFF4F6', fontSize: 17, fontWeight: '700' },
  counter: { backgroundColor: '#34262D', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14 },
  counterText: { color: '#F3C1CA', fontSize: 11, fontWeight: '600' },
  hint: { color: '#BBB3B7', fontSize: 12, lineHeight: 17 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { flexBasis: '45%', flexGrow: 1, minHeight: 112, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: '#222222', alignItems: 'center', justifyContent: 'center', gap: 6 },
  lightCard: { backgroundColor: '#3C3937' },
  selectedCard: { backgroundColor: '#F3C1CA' },
  image: { width: 64, height: 64 },
  name: { color: '#F6F2F3', fontSize: 14, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  selectedName: { color: '#331C23' },
  check: { position: 'absolute', top: 9, right: 9, width: 20, height: 20, borderRadius: 10, backgroundColor: '#331C23', alignItems: 'center', justifyContent: 'center' },
  unavailable: { opacity: 0.45 },
});
