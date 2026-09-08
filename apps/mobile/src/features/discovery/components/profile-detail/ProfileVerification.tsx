import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ProfileVerificationProps {
  user: any;
}

export const ProfileVerification: React.FC<ProfileVerificationProps> = ({ user }) => {
  const verifications = Array.isArray(user.verifications) ? user.verifications : [];

  if (!verifications || verifications.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>VERIFIED INFO</Text>
      <View style={styles.list}>
        {verifications.map((item: string, idx: number) => (
          <View key={idx} style={styles.verificationRow}>
            <View style={styles.iconTile}>
              <Ionicons name="shield-checkmark" size={16} color="#26de81" />
            </View>
            <Text style={styles.verificationText}>{item}</Text>
            <View style={styles.badgeChip}>
              <Text style={styles.badgeText}>Verified</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 2,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 12,
    backgroundColor: '#13131a',
    borderRadius: 12,
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
  list: {
    gap: 16,
  },
  verificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: 'rgba(38, 222, 129, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  verificationText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.9)',
    flex: 1,
  },
  badgeChip: {
    backgroundColor: 'rgba(38, 222, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 10,
    color: '#26de81',
    textTransform: 'uppercase',
  }
});
