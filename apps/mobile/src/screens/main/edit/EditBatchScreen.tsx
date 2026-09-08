import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { EditScreenHeader } from '../../../components/EditScreenHeader';
import { api } from '../../../services/api';
import { useDispatch } from 'react-redux';
import { updateUser } from '../../../store/authSlice';

const { width } = Dimensions.get('window');
const batchOptions = Array.from({ length: 13 }, (_, i) => 2020 + i);

export const EditBatchScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { currentBatch } = route.params || {};

  const [selected, setSelected] = useState<number | null>(currentBatch ? parseInt(currentBatch) : null);
  const [saving, setSaving] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await api.put('/profile', { graduationYear: selected });
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <EditScreenHeader 
        title="Batch" 
        onCancel={() => navigation.goBack()} 
        onSave={handleSave} 
        saving={saving} 
        saveDisabled={!selected}
        hasUnsavedChanges={selected !== null && selected !== (currentBatch ? parseInt(currentBatch) : null)}
      />
      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.title}>Which batch?</Text>
          <Text style={styles.subtitle}>Knowing your batch helps us match you with people in a similar phase of their college journey.</Text>

          <View style={styles.gridContainer}>
            {batchOptions.map((year) => (
              <TouchableOpacity
                key={year}
                style={[styles.batchItem, selected === year && styles.batchItemSelected]}
                onPress={() => setSelected(year)}
                activeOpacity={0.7}
              >
                <Text style={[styles.batchText, selected === year && styles.batchTextSelected]}>{year}</Text>
              </TouchableOpacity>
            ))}
          </View>
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
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.6)', lineHeight: 22, marginBottom: 24 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingTop: 10 },
  batchItem: {
    width: (width - 60) / 3, aspectRatio: 1.5, borderRadius: 12, borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.02)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 15,
  },
  batchItemSelected: { borderColor: '#F94E27', backgroundColor: 'rgba(249, 78, 39, 0.1)' },
  batchText: { fontSize: 20, fontWeight: '700', color: 'rgba(255,255,255,0.8)' },
  batchTextSelected: { color: '#FFF' },
});
