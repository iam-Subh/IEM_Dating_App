import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SettingsPage, settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { saveHiddenWords, useHiddenWords } from './hiddenWords';

const SUGGESTIONS = ['send nudes', 'sexy', 'hot', 'your insta', 'snapchat', 'whatsapp', 'telegram', 'hookup', 'single?'];
const MAX = 300;

/**
 * Settings > Safety and help > Hidden Words (as Hinge has it): messages and
 * Rose notes with these words or phrases are folded away until tapped. Only
 * you see your list; nobody is told.
 */
export function HiddenWordsScreen() {
  const insets = useSafeAreaInsets();
  const words = useHiddenWords();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const save = async (next: string[]) => {
    setError('');
    try { await saveHiddenWords(next); } catch { setError('Could not save. Check your connection and try again.'); }
  };
  const add = (value: string) => {
    const word = value.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!word || word.length > 40) return;
    setDraft('');
    if (words.includes(word) || words.length >= MAX) return;
    void save([...words, word]);
  };
  const remove = (word: string) => void save(words.filter((item) => item !== word));

  return <SettingsPage title="Hidden Words">
    <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={styles.intro}>Messages and Rose notes with these words or phrases are folded away - tap one to read it. Only you see this list.</Text>
      <View style={styles.inputRow}>
        <TextInput value={draft} onChangeText={setDraft} onSubmitEditing={() => add(draft)} placeholder="Add a word or phrase"
          placeholderTextColor={palette.muted} autoCapitalize="none" autoCorrect={false} maxLength={40} returnKeyType="done"
          style={styles.input} accessibilityLabel="Add a hidden word" />
        <Pressable accessibilityRole="button" disabled={!draft.trim()} onPress={() => add(draft)} style={({ pressed }) => [styles.add, !draft.trim() && styles.disabled, pressed && styles.pressed]}>
          <Text style={styles.addText}>Add</Text>
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <Text style={styles.label}>Your words · {words.length}</Text>
      {words.length ? <View style={styles.chips}>
        {words.map((word) => <Pressable key={word} accessibilityRole="button" accessibilityLabel={`Remove ${word}`} onPress={() => remove(word)} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
          <Text style={styles.chipText}>{word}</Text><Ionicons name="close" size={14} color={palette.secondary} />
        </Pressable>)}
      </View> : <Text style={styles.empty}>None yet.</Text>}

      {SUGGESTIONS.some((word) => !words.includes(word)) ? <>
        <Text style={styles.label}>Suggestions</Text>
        <View style={styles.chips}>
          {SUGGESTIONS.filter((word) => !words.includes(word)).map((word) => <Pressable key={word} accessibilityRole="button" accessibilityLabel={`Add ${word}`} onPress={() => add(word)} style={({ pressed }) => [styles.chip, styles.suggestion, pressed && styles.pressed]}>
            <Ionicons name="add" size={14} color={palette.accent} /><Text style={styles.chipText}>{word}</Text>
          </Pressable>)}
        </View>
      </> : null}
    </KeyboardAwareScrollView>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 8 },
  intro: { fontFamily: 'DMSans_400Regular', fontSize: 14, lineHeight: 20, color: palette.secondary },
  inputRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  input: { flex: 1, height: 48, borderRadius: 14, backgroundColor: palette.card, color: palette.text, paddingHorizontal: 14, fontFamily: 'DMSans_500Medium', fontSize: 15 },
  add: { height: 48, paddingHorizontal: 18, borderRadius: 14, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  addText: { fontFamily: 'DMSans_700Bold', fontSize: 14, color: palette.accentText },
  error: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.danger, marginTop: 8 },
  label: { fontFamily: 'DMSans_700Bold', fontSize: 13, color: palette.secondary, marginTop: 24, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: palette.card },
  suggestion: { borderWidth: 1, borderColor: palette.separator, backgroundColor: 'transparent' },
  chipText: { fontFamily: 'DMSans_500Medium', fontSize: 13, color: palette.text },
  empty: { fontFamily: 'DMSans_400Regular', fontSize: 13, color: palette.muted },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
