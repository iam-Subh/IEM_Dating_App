import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  SafeAreaView,
  Modal,
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSelector, useDispatch } from 'react-redux';
import { RootState } from '../../store';
import { api } from '../../services/api';
import { updateUser } from '../../store/authSlice';
import { colors } from '../../core/theme/colors';
import { useNavigation } from '@react-navigation/native';
import { SwipeCard } from '../../features/discovery/components/SwipeCard';
import { PremiumProfileModal } from '../../components/PremiumProfileModal';

const { width } = Dimensions.get('window');
const PHOTO_SIZE = width * 0.35; // Compact horizontal scrolling photos

interface ProfilePhoto {
  id: string;
  photoUrl: string;
  isPrimary: boolean;
}

interface ProfileData {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  birthday?: string;
  age?: number;
  gender?: string;
  showGender: boolean;
  orientation: string[];
  showOrientation: boolean;
  seeking?: string;
  college?: string;
  department?: string;
  graduationYear?: number;
  campus?: string;
  degree?: string;
  isHosteller?: boolean;
  clubs: string[];
  hangoutSpots: string[];
  attendanceMood?: string;
  distancePreference?: number;
  preferences?: any;
  isVerified: boolean;
  avatarUrl?: string;
  profileVideoUrl?: string;
  photos: ProfilePhoto[];
  createdAt: string;
}

// Section component for consistent styling
const Section = ({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Ionicons name={icon as any} size={18} color={colors.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>
);

// Chip component
const Chip = ({ label, icon }: { label: string; icon?: string }) => (
  <View style={styles.chip}>
    {icon && <Ionicons name={icon as any} size={14} color={colors.primary} style={{ marginRight: 4 }} />}
    <Text style={styles.chipText}>{label}</Text>
  </View>
);

// Detail row
const DetailRow = ({ icon, label, value, hidden }: { icon: string; label: string; value: string; hidden?: boolean }) => (
  <View style={styles.detailRow}>
    <Ionicons name={icon as any} size={18} color={colors.text.tertiary} />
    <View style={styles.detailContent}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
    {hidden !== undefined && (
      <Ionicons
        name={hidden ? 'eye-off-outline' : 'eye-outline'}
        size={16}
        color={colors.text.tertiary}
      />
    )}
  </View>
);

export const ProfileScreen = () => {
  const dispatch = useDispatch();
  const navigation = useNavigation<any>();
  const reduxUser = useSelector((state: RootState) => state.auth.user);
  const profile = reduxUser as ProfileData | null;
  const [loading, setLoading] = useState(!reduxUser);
  const [refreshing, setRefreshing] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      const response = await api.get('/profile');
      if (response.data?.success) {
        dispatch(updateUser(response.data.data));
      }
    } catch (err) {
      console.error('[Profile] Error fetching profile:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dispatch]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.loadingContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={colors.text.tertiary} />
        <Text style={styles.errorText}>Could not load profile</Text>
        <TouchableOpacity onPress={fetchProfile} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const avatarImageUri = profile.avatarUrl || profile.photos?.find(p => p.isPrimary)?.photoUrl || profile.photos?.[0]?.photoUrl;

  // Helper to build user object for SwipeCard preview
  const previewUser = {
    ...profile,
    id: profile.id,
    name: profile.name,
    graduationYear: profile.graduationYear ?? null,
    department: profile.department || '',
    imageUri: avatarImageUri || '',
    intent: profile.seeking || 'Networking',
    matchPercentage: 100, // It's their own profile
    distance: 'You',
    tags: [...(profile.clubs || []), ...(profile.hangoutSpots || [])],
    photos: (profile.photos || []).map(p => p.photoUrl),
    video: profile.profileVideoUrl || null,
    videoPreview: null, // Depending on if we added this field to ProfileData
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Dashboard Header */}
        <View style={styles.dashboardHeader}>
          <TouchableOpacity 
            style={styles.avatarContainer}
            onPress={() => avatarImageUri && setSelectedImageUrl(avatarImageUri)}
            activeOpacity={0.9}
          >
            {/* Completion Ring Effect */}
            <View style={styles.completionRing} pointerEvents="none" />
            
            {avatarImageUri ? (
              <Image source={{ uri: avatarImageUri }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.heroPlaceholder]}>
                <Ionicons name="person" size={40} color={colors.text.tertiary} />
              </View>
            )}
            {profile.isVerified && (
              <View style={styles.verifiedBadgeAvatar}>
                {/* A solid white circular background behind the curvy star */}
                <View style={styles.verifiedBadgeBackground} />
                <MaterialIcons name="verified" size={28} color="#3b82f6" />
              </View>
            )}
          </TouchableOpacity>
          
          <Text style={styles.dashboardName}>
            {profile.name}{profile.age ? `, ${profile.age}` : ''}
          </Text>
          <Text style={styles.dashboardSubtitle}>
            {profile.department ? `${profile.department} ` : ''}
            {profile.graduationYear ? `• Class of ${profile.graduationYear}` : ''}
          </Text>
        </View>

        {/* Action Row */}
        <View style={styles.actionRow}>
          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => navigation.navigate('EditProfile', { profile })}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: 'rgba(236,72,153,0.1)' }]}>
              <Ionicons name="pencil-outline" size={24} color={colors.primary} />
            </View>
            <Text style={styles.actionText}>Edit Info</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => setPreviewVisible(true)}
          >
             <View style={[styles.actionIconContainer, { backgroundColor: 'rgba(59,130,246,0.1)' }]}>
              <Ionicons name="eye-outline" size={24} color="#3b82f6" />
            </View>
            <Text style={styles.actionText}>Preview</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionCard}
            onPress={() => navigation.navigate('Settings')}
          >
             <View style={[styles.actionIconContainer, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
              <Ionicons name="settings-outline" size={24} color={colors.text.primary} />
            </View>
            <Text style={styles.actionText}>Settings</Text>
          </TouchableOpacity>
        </View>

        {/* Photos Carousel */}
        {profile.photos && profile.photos.length > 0 && (
          <View style={styles.carouselContainer}>
            <View style={styles.carouselHeader}>
              <Ionicons name="images-outline" size={18} color={colors.primary} />
              <Text style={styles.sectionHeaderCarousel}>My Photos</Text>
            </View>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.carouselContent}
            >
              {profile.photos.map((photo) => (
                <TouchableOpacity 
                  key={photo.id} 
                  style={styles.carouselItem}
                  onPress={() => setSelectedImageUrl(photo.photoUrl)}
                  activeOpacity={0.9}
                >
                  <Image source={{ uri: photo.photoUrl }} style={styles.carouselImage} />
                  {photo.isPrimary && (
                    <View style={styles.primaryBadge}>
                      <Ionicons name="star" size={12} color="#fff" />
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* About Section */}
        <Section title="About" icon="person-outline">
          {profile.seeking && (
            <DetailRow icon="heart-outline" label="Looking for" value={profile.seeking} />
          )}
          {profile.gender && (
            <DetailRow
              icon="male-female-outline"
              label="Gender"
              value={profile.gender}
              hidden={!profile.showGender}
            />
          )}
          {profile.orientation && profile.orientation.length > 0 && (
            <DetailRow
              icon="rainbow-outline"
              label="Orientation"
              value={profile.orientation.join(', ')}
              hidden={!profile.showOrientation}
            />
          )}
          {profile.attendanceMood && (
            <DetailRow icon="happy-outline" label="Attendance Mood" value={profile.attendanceMood} />
          )}
        </Section>

        {/* Academic Section */}
        <Section title="Academics" icon="business-outline">
          {profile.college && (
            <DetailRow icon="business-outline" label="College" value={profile.college} />
          )}
          {profile.department && (
            <DetailRow icon="book-outline" label="Department" value={profile.department} />
          )}
          {profile.graduationYear && (
            <DetailRow icon="calendar-outline" label="Graduation year" value={`${profile.graduationYear}`} />
          )}
          {profile.campus && (
            <DetailRow icon="location-outline" label="Campus" value={profile.campus} />
          )}
          {profile.degree && (
            <DetailRow icon="ribbon-outline" label="Degree" value={profile.degree} />
          )}
          {profile.isHosteller !== null && profile.isHosteller !== undefined && (
            <DetailRow
              icon="home-outline"
              label="Accommodation"
              value={profile.isHosteller ? 'Hosteller' : 'Day Scholar'}
            />
          )}
        </Section>

        {/* Interests Section */}
        {((profile.clubs && profile.clubs.length > 0) || (profile.hangoutSpots && profile.hangoutSpots.length > 0)) && (
          <Section title="Interests" icon="sparkles-outline">
            {profile.clubs && profile.clubs.length > 0 && (
              <View style={styles.chipGroup}>
                <Text style={styles.chipGroupLabel}>Clubs</Text>
                <View style={styles.chipRow}>
                  {profile.clubs.map((club, i) => (
                    <Chip key={`club-${i}`} label={club} icon="people-outline" />
                  ))}
                </View>
              </View>
            )}
            {profile.hangoutSpots && profile.hangoutSpots.length > 0 && (
              <View style={styles.chipGroup}>
                <Text style={styles.chipGroupLabel}>Hangout Spots</Text>
                <View style={styles.chipRow}>
                  {profile.hangoutSpots.map((spot, i) => (
                    <Chip key={`spot-${i}`} label={spot} icon="cafe-outline" />
                  ))}
                </View>
              </View>
            )}
          </Section>
        )}
      </ScrollView>

      {/* Premium Profile Preview Modal */}
      <PremiumProfileModal
        visible={previewVisible}
        onClose={() => setPreviewVisible(false)}
        user={previewUser}
      />

      {/* Full Screen Image Viewer */}
      <Modal 
        visible={!!selectedImageUrl} 
        transparent 
        animationType="fade"
        onRequestClose={() => setSelectedImageUrl(null)}
      >
        <TouchableOpacity 
          style={styles.imageViewerOverlay} 
          activeOpacity={1} 
          onPress={() => setSelectedImageUrl(null)}
        >
          <TouchableOpacity 
            style={styles.closeViewerButton} 
            onPress={() => setSelectedImageUrl(null)}
          >
            <Ionicons name="close-circle" size={44} color="#fff" />
          </TouchableOpacity>
          <Image 
            source={{ uri: selectedImageUrl || '' }} 
            style={styles.fullScreenImage} 
            resizeMode="contain" 
          />
        </TouchableOpacity>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    color: colors.text.secondary,
    marginTop: 8,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },

  // Dashboard Header
  dashboardHeader: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 24,
  },
  avatarContainer: {
    position: 'relative',
    width: 128,
    height: 128,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.surface,
  },
  heroPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  verifiedBadgeAvatar: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'transparent',
    padding: 0,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifiedBadgeBackground: {
    position: 'absolute',
    width: 14,
    height: 14,
    backgroundColor: '#fff',
    borderRadius: 7,
    zIndex: -1,
  },
  completionRing: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 64,
    borderWidth: 3,
    borderColor: colors.primary,
  },
  dashboardName: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text.primary,
    marginBottom: 4,
  },
  dashboardSubtitle: {
    fontSize: 15,
    color: colors.text.secondary,
  },

  // Action Row
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingHorizontal: 16,
    marginBottom: 32,
  },
  actionCard: {
    alignItems: 'center',
    gap: 8,
  },
  actionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text.secondary,
  },

  // Carousel
  carouselContainer: {
    marginBottom: 8,
  },
  carouselHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 20,
    marginBottom: 16,
  },
  sectionHeaderCarousel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },
  carouselContent: {
    paddingHorizontal: 20,
    gap: 10,
  },
  carouselItem: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE * 1.2,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  carouselImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  primaryBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Sections
  section: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
  },

  // Detail rows
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    color: colors.text.tertiary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 15,
    color: colors.text.primary,
    fontWeight: '500',
  },

  // Chips
  chipGroup: {
    marginBottom: 12,
  },
  chipGroupLabel: {
    fontSize: 13,
    color: colors.text.secondary,
    fontWeight: '600',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipText: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '500',
  },

  // Image Viewer
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullScreenImage: {
    width: width,
    height: width * 1.5, // Standard aspect ratio for dating apps
    maxHeight: '80%',
  },
  closeViewerButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
});
