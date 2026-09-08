import React, { useState, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, ScrollView, Alert, Platform, TextInput } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { EditScreenHeader } from '../../../components/EditScreenHeader';
import { api } from '../../../services/api';
import { useDispatch } from 'react-redux';
import { updateUser } from '../../../store/authSlice';

import { INTEREST_CATEGORIES, normalizeInterests } from '@iem-dating/shared/interest-catalog';

export const EditInterestsScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentInterests } = route.params || {};

  const [selected, setSelected] = useState<string[]>(normalizeInterests(currentInterests));
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  const toggleInterest = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const filtered = useMemo(() => {
    if (!searchQuery) return INTEREST_CATEGORIES;
    const q = searchQuery.toLowerCase();
    return INTEREST_CATEGORIES.map(cat => ({
      ...cat,
      interests: cat.interests.filter(i => i.label.toLowerCase().includes(q)),
    })).filter(cat => cat.interests.length > 0);
  }, [searchQuery]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await api.put('/profile', { preferences: { interests: selected } });
      if (response.data?.success) dispatch(updateUser(response.data.data));
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally { setSaving(false); }
  };

  return (
    <View style={styles.container}>
      <EditScreenHeader 
        title="Interests" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        hasUnsavedChanges={
          selected.length !== (currentInterests || []).length || 
          selected.some(i => !(currentInterests || []).includes(i))
        }
      />
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Interests</Text>
          <Text style={styles.subtitle}>Select interests to show on your profile.</Text>

          <View style={styles.searchContainer}>
            <MaterialCommunityIcons name="magnify" size={20} color="rgba(255,255,255,0.4)" style={{ marginRight: 10 }} />
            <TextInput style={styles.searchInput} placeholder="Search" placeholderTextColor="rgba(255,255,255,0.4)" value={searchQuery} onChangeText={setSearchQuery} />
          </View>

          {filtered.map(cat => {
            const isExpanded = expandedCategories[cat.id];
            const visible = isExpanded ? cat.interests : cat.interests.slice(0, 8);
            const hasMore = cat.interests.length > 8;
            const selectedCount = cat.interests.filter(i => selected.includes(i.id)).length;

            return (
              <View key={cat.id} style={styles.catSection}>
                <View style={styles.catHeader}>
                  <Text style={styles.catEmoji}>{cat.emoji}</Text>
                  <Text style={styles.catTitle}>{cat.title}</Text>
                  {selectedCount > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{selectedCount}</Text></View>}
                </View>
                <View style={styles.pillsContainer}>
                  {visible.map(interest => {
                    const id = interest.id;
                    return (
                      <TouchableOpacity key={id} style={[styles.pill, selected.includes(id) && styles.pillSelected]} onPress={() => toggleInterest(id)} activeOpacity={0.7}>
                        <Text style={[styles.pillText, selected.includes(id) && styles.pillTextSelected]}>{interest.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {hasMore && !searchQuery && (
                  <TouchableOpacity style={styles.showMore} onPress={() => setExpandedCategories(prev => ({ ...prev, [cat.id]: !prev[cat.id] }))}>
                    <Text style={styles.showMoreText}>{isExpanded ? 'Show less' : 'Show more'}</Text>
                    <MaterialCommunityIcons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="rgba(255,255,255,0.4)" />
                  </TouchableOpacity>
                )}
                <View style={styles.divider} />
              </View>
            );
          })}
        </ScrollView>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F1115' },
  content: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 30, fontWeight: '800', color: '#FFF', marginBottom: 12 },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.6)', marginBottom: 24 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', height: 48, borderRadius: 12, paddingHorizontal: 15, marginBottom: 32 },
  searchInput: { flex: 1, color: '#FFF', fontSize: 16, padding: 0 },
  catSection: { marginBottom: 24 },
  catHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  catEmoji: { fontSize: 18, marginRight: 10 },
  catTitle: { fontSize: 17, fontWeight: '700', color: '#FFF' },
  badge: { marginLeft: 8, backgroundColor: '#F94E27', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  pillsContainer: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { height: 38, paddingHorizontal: 16, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', marginRight: 8, marginBottom: 10, alignItems: 'center', justifyContent: 'center' },
  pillSelected: { borderColor: '#F94E27', backgroundColor: 'rgba(255,255,255,0.05)' },
  pillText: { color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: '600' },
  pillTextSelected: { color: '#FFF' },
  showMore: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  showMoreText: { color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: '600', marginRight: 4 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginTop: 12 },
});
