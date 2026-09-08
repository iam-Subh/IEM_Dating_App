import { compatibilityValue, compatibilityColor } from '../../compatibility';
import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

interface ProfileBasicInfoProps {
  user: any;
}

export const ProfileBasicInfo: React.FC<ProfileBasicInfoProps> = ({ user }) => {
  const matchPercentage = compatibilityValue(user.matchPercentage);
  const getBadgeColor = compatibilityColor;

  const getAge = (dob: string | Date | undefined) => {
    if (!dob) return '';
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25)).toString();
  };

  const age = user.age ?? '';
  const college = user.college || 'Not specified';

  // Animations
  const pillScale = useRef(new Animated.Value(0)).current;
  const dotOpacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    // Match pill bounce
    Animated.spring(pillScale, {
      toValue: 1,
      friction: 4,
      tension: 100,
      useNativeDriver: true,
      delay: 300,
    }).start();

    // Infinite pulsing dot
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotOpacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(dotOpacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        })
      ])
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      {/* Looking For Section */}
      {user.seeking && (
        <View style={styles.intentHorizontalContainer}>
          <View style={styles.intentHeaderRow}>
            <Ionicons name="search" size={16} color="#8e8e93" />
            <Text style={styles.horizontalSectionTitle}>Looking for</Text>
          </View>
          <View style={styles.intentValueRow}>
            <Text style={styles.intentValueText}>💕 {user.seeking}</Text>
          </View>
        </View>
      )}

      {/* Structured Info Section (Rows) */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Ionicons name="person-circle" size={28} color="#8e8e93" />
          <Text style={styles.sectionTitleHeader}>Basics</Text>
        </View>
        <View style={styles.infoRowsContainer}>
          {user.showGender && user.gender && (
            <View style={styles.lifestyleRow}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Gender</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="person" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.gender}</Text>
              </View>
            </View>
          )}

          {age !== '' && (
            <View style={[styles.lifestyleRow, user.showGender && user.gender && styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Age</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="calendar" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{age} years old</Text>
              </View>
            </View>
          )}

          <View style={[styles.lifestyleRow, user.showGender && styles.rowBorder]}>
            <View style={styles.rowHeader}>
              <Text style={styles.rowLabelText}>College</Text>
            </View>
            <View style={styles.rowValueContainer}>
              <Ionicons name="business" size={18} color="#8e8e93" style={styles.rowIcon} />
              <Text style={styles.rowValueText}>{college}</Text>
            </View>
          </View>

          {user.department && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Stream</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="laptop-outline" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.department}</Text>
              </View>
            </View>
          )}

          {user.yearOfStudy && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Year of Study</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="school-outline" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.yearOfStudy}{user.yearOfStudy === 1 ? 'st' : user.yearOfStudy === 2 ? 'nd' : user.yearOfStudy === 3 ? 'rd' : 'th'} Year</Text>
              </View>
            </View>
          )}

          {user.graduationYear && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Batch</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="calendar-outline" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>Class of {user.graduationYear}</Text>
              </View>
            </View>
          )}

          {user.isHosteller !== null && user.isHosteller !== undefined && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Living</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="home-outline" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.isHosteller ? 'Hosteller' : 'Day Scholar'}</Text>
              </View>
            </View>
          )}

          {user.degree && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Degree</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="school" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.degree}</Text>
              </View>
            </View>
          )}

          {user.attendanceMood && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Attendance</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="book" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.attendanceMood}</Text>
              </View>
            </View>
          )}

          {user.clubs && user.clubs.length > 0 && (
            <View style={[styles.lifestyleRow, styles.rowBorder]}>
              <View style={styles.rowHeader}>
                <Text style={styles.rowLabelText}>Clubs</Text>
              </View>
              <View style={styles.rowValueContainer}>
                <Ionicons name="people" size={18} color="#8e8e93" style={styles.rowIcon} />
                <Text style={styles.rowValueText}>{user.clubs.join(', ')}</Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 2,
    marginTop: 10,
    paddingBottom: 8,
    zIndex: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  nameText: {
    fontFamily: 'Syne_800ExtraBold',
    fontSize: 36,
    color: '#FFF',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  iconMargin: {
    marginLeft: 8,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#26de81',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.5)',
    marginLeft: 6,
  },
  verifiedBadgeContainer: {
    marginLeft: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    marginTop: 8, // Shift down to align with bottom of name text
  },
  verifiedBadgeBackground: {
    position: 'absolute',
    width: 16,
    height: 16,
    backgroundColor: '#FFF',
    borderRadius: 8,
    zIndex: -1,
  },
  matchBadge: {
    borderWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    shadowColor: '#ff5c5c',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 8,
  },
  matchText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 12,
    color: '#FFF',
  },
  rightBadgesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  activeStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeText: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    marginLeft: 4,
    fontWeight: '600',
  },
  intentHorizontalContainer: {
    backgroundColor: '#13131a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  intentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  horizontalSectionTitle: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
    color: '#8e8e93',
  },
  intentValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
  },
  intentValueText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
    color: '#FFF',
  },
  section: {
    backgroundColor: '#13131a',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitleHeader: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 14,
    color: '#8e8e93',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  infoRowsContainer: {
    marginTop: 0,
  },
  lifestyleRow: {
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  rowHeader: {
    marginBottom: 6,
  },
  rowLabelText: {
    fontFamily: 'DMSans_500Medium',
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
  },
  rowValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    marginRight: 10,
  },
  rowValueText: {
    fontFamily: 'DMSans_700Bold',
    fontSize: 16,
    color: '#FFF',
    flex: 1,
  },
});
