import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface ProfileVibesProps {
  user: any;
}

export const ProfileVibes: React.FC<ProfileVibesProps> = ({ user }) => {
  const clubs = user.clubs || [];
  const attendanceStyle = user.attendanceMood;
  const sectorVSpot = user.hangoutSpots?.[0];

  const socials = Array.isArray(user.socials) ? user.socials : [];

  const gridItems = [];
  
  socials.forEach((s: any) => {
    gridItems.push({
      type: 'social', platform: s.platform, label: s.label, icon: s.icon, color: s.color
    });
  });

  if (sectorVSpot) {
    gridItems.push({ type: 'vibe', platform: 'Hangout', label: sectorVSpot, icon: 'cafe', color: '#45aaf2' });
  }

  if (gridItems.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>SOCIAL & VIBES</Text>
      
      {/* 2x2 Grid */}
      <View style={styles.gridContainer}>
        {gridItems.slice(0, 4).map((item, idx) => (
          <View key={idx} style={styles.gridCard}>
            <View style={styles.iconWrapper}>
              {item.platform === 'Instagram' ? (
                <LinearGradient
                  colors={['#833ab4', '#fd1d1d', '#fcb045']}
                  style={styles.brandedTile}
                  start={{x: 0, y: 1}} end={{x: 1, y: 0}}
                >
                  <Ionicons name="logo-instagram" size={18} color="#FFF" />
                </LinearGradient>
              ) : (
                <View style={[styles.brandedTile, { backgroundColor: item.color + '15' }]}>
                  <Ionicons name={item.icon as any} size={18} color={item.color} />
                </View>
              )}
            </View>
            <View style={styles.textWrapper}>
              <Text style={styles.cardLabel}>{item.platform}</Text>
              <Text style={styles.cardValue} numberOfLines={1}>{item.label}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#13131a',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  sectionTitle: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 11,
    color: '#8e8e93',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: '48%', // Flexible for 2x2
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  iconWrapper: {
    marginBottom: 12,
  },
  brandedTile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textWrapper: {
    gap: 2,
  },
  cardLabel: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
  },
  cardValue: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
  }
});
