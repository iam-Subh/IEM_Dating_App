import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { settingsPalette as palette } from '../../core/settings/SettingsLayout';
import { navigationRef } from '../../navigation/navigationRef';
import { currentScreen } from './diagnostics';

/**
 * When a screen crashes: a calm page instead of a blank or red screen, with
 * "Try again" and "Tell us" (docs/FEEDBACK.md). The error itself is already in
 * the report's technical details (diagnostics.ts keeps the last errors).
 */
type State = { error: Error | null; screen: string | null };

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode; signedIn: boolean }, State> {
  state: State = { error: null, screen: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ screen: currentScreen() });
    console.error('[Crash]', error, info.componentStack?.split('\n').slice(0, 4).join(' '));
  }

  private retry = () => this.setState({ error: null, screen: null });

  private report = () => {
    const screen = this.state.screen;
    // Away from the screen that crashed, so it is not drawn again behind the form.
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 1, routes: [{ name: 'Main' }, { name: 'ReportProblem', params: { source: 'error', screen } }] });
    }
    this.retry();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <View style={styles.page}>
      <View style={styles.icon}><Ionicons name="bandage-outline" size={30} color={palette.accentText} /></View>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>This screen stopped working. Try again - and if it keeps happening, tell us so we can fix it.</Text>
      <Pressable style={styles.primary} onPress={this.retry} accessibilityRole="button"><Text style={styles.primaryText}>Try again</Text></Pressable>
      {this.props.signedIn && <Pressable style={styles.secondary} onPress={this.report} accessibilityRole="button"><Text style={styles.secondaryText}>Tell us what happened</Text></Pressable>}
    </View>;
  }
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#100F0D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  title: { color: '#FFFFFF', fontFamily: 'DMSans_700Bold', fontSize: 22, textAlign: 'center' },
  body: { color: palette.secondary, fontFamily: 'DMSans_400Regular', fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 12 },
  primary: { height: 50, alignSelf: 'stretch', borderRadius: 25, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: palette.accentText, fontFamily: 'DMSans_700Bold', fontSize: 16 },
  secondary: { height: 46, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: palette.accent, fontFamily: 'DMSans_500Medium', fontSize: 15 },
});
