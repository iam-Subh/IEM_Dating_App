import React, { useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  TouchableWithoutFeedback,
  Dimensions,
  Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../../core/theme/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface MessageOptionsSheetProps {
  isVisible: boolean;
  onClose: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onCopy: () => void;
  onReport: () => void;
  onReaction: (emoji: string) => void;
  onEdit: () => void;
  onReply: () => void;
  isMe: boolean;
}

export const MessageOptionsSheet = ({
  isVisible,
  onClose,
  onDeleteForMe,
  onDeleteForEveryone,
  onCopy,
  onReport,
  onReaction,
  onEdit,
  onReply,
  isMe,
}: MessageOptionsSheetProps) => {
  const translateY = useSharedValue(SCREEN_HEIGHT);

  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  useEffect(() => {
    if (isVisible) {
      translateY.value = withSpring(0, {
        damping: 20,
        stiffness: 150,
        mass: 0.6,
        overshootClamping: true,
      });
    } else {
      translateY.value = withTiming(SCREEN_HEIGHT, {
        duration: 250,
      });
      // Reset state on close
      setTimeout(() => setShowDeleteConfirm(false), 250);
    }
  }, [isVisible]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }],
    };
  });

  if (!isVisible) return null;

  return (
    <Modal
      visible={isVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <Animated.View style={[styles.sheetContainer, animatedStyle]}>
          <BlurView intensity={80} tint="dark" style={styles.blurContainer}>
            <View style={styles.handle} />
            
            <Text style={styles.title}>
              {showDeleteConfirm ? 'Delete Message?' : 'Message Options'}
            </Text>

            <View style={styles.optionsList}>
              {!showDeleteConfirm ? (
                <>
                  <View style={styles.reactions}>
                    {['❤️', '👍', '😂', '😮', '😢', '🔥'].map((emoji) => <TouchableOpacity key={emoji} onPress={() => onReaction(emoji)}><Text style={styles.reaction}>{emoji}</Text></TouchableOpacity>)}
                  </View>
                  <TouchableOpacity style={styles.optionItem} onPress={onReply}>
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Ionicons name="return-up-back-outline" size={22} color="white" /></View>
                    <Text style={styles.optionText}>Reply</Text>
                  </TouchableOpacity>
                  {isMe && <TouchableOpacity style={styles.optionItem} onPress={onEdit}>
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(255,255,255,0.1)' }]}><Ionicons name="create-outline" size={22} color="white" /></View>
                    <Text style={styles.optionText}>Edit message</Text>
                  </TouchableOpacity>}
                  {/* Copy Option */}
                  <TouchableOpacity style={styles.optionItem} onPress={onCopy}>
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                      <Ionicons name="copy-outline" size={22} color="white" />
                    </View>
                    <Text style={styles.optionText}>Copy Text</Text>
                  </TouchableOpacity>

                  {/* Report Option */}
                  {!isMe && <TouchableOpacity style={styles.optionItem} onPress={onReport}>
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                      <Ionicons name="flag-outline" size={22} color="white" />
                    </View>
                    <Text style={styles.optionText}>Report Message</Text>
                  </TouchableOpacity>}

                  {/* Initial Delete Trigger */}
                  <TouchableOpacity 
                    style={[styles.optionItem, styles.deleteItem]} 
                    onPress={() => setShowDeleteConfirm(true)}
                  >
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(239,68,68,0.1)' }]}>
                      <Ionicons name="trash-outline" size={22} color="#ef4444" />
                    </View>
                    <Text style={[styles.optionText, { color: '#ef4444' }]}>Delete Message</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Delete Options */}
                  <TouchableOpacity 
                    style={styles.optionItem} 
                    onPress={onDeleteForMe}
                  >
                    <View style={[styles.iconContainer, { backgroundColor: 'rgba(239,68,68,0.1)' }]}>
                      <Ionicons name="trash-outline" size={20} color="#ef4444" />
                    </View>
                    <Text style={[styles.optionText, { color: '#ef4444' }]}>Delete for me</Text>
                  </TouchableOpacity>

                  {isMe && (
                    <TouchableOpacity 
                      style={styles.optionItem} 
                      onPress={onDeleteForEveryone}
                    >
                      <View style={[styles.iconContainer, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
                        <Ionicons name="people-outline" size={20} color="#ef4444" />
                      </View>
                      <Text style={[styles.optionText, { color: '#ef4444' }]}>Delete for everyone</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity 
                    style={[styles.optionItem, { backgroundColor: 'transparent' }]} 
                    onPress={() => setShowDeleteConfirm(false)}
                  >
                    <Text style={[styles.optionText, { textAlign: 'center', width: '100%', color: 'rgba(255,255,255,0.5)' }]}>Go Back</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </BlurView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  reactions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 },
  reaction: { fontSize: 25 },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetContainer: {
    width: '100%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a', // Fallback for BlurView
  },
  blurContainer: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
    textAlign: 'center',
    marginBottom: 24,
  },
  optionsList: {
    gap: 12,
    marginBottom: 24,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  optionText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  deleteItem: {
    marginTop: 8,
  },
  cancelButton: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: 'white',
  },
});
