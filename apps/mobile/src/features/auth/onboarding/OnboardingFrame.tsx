import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, StatusBar, ActivityIndicator, KeyboardAvoidingView, Platform, TextInput, TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { rose } from './theme';

const chapters = ['ABOUT YOU', 'YOUR WORLD', 'YOUR CONNECTION', 'YOUR PROFILE'];
export function OnboardingFrame({ title, subtitle, stage, eyebrow, onBack, onSkip, action = 'Continue', onNext, disabled, busy, error, children }: {
  title: string; subtitle?: string; stage?: number; eyebrow?: string; onBack?: () => void; onSkip?: () => void;
  action?: string; onNext?: () => void; disabled?: boolean; busy?: boolean; error?: string; children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return <View style={[ui.page, { paddingTop: insets.top }]}>
    <StatusBar barStyle="light-content" backgroundColor={rose.canvas} />
    <View style={ui.nav}>
      {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={onBack} style={ui.navButton}><Ionicons name="arrow-back" size={20} color={rose.text} /></Pressable> : <Text style={ui.monogram}>c.</Text>}
      <Text style={ui.wordmark}>iem connect.</Text>
      {onSkip ? <Pressable accessibilityRole="button" accessibilityLabel="Skip this step" disabled={busy} onPress={onSkip} style={({pressed}) => [ui.navButton, pressed && {opacity: 0.6}]}><Text style={ui.link}>Skip</Text></Pressable> : <View style={{width: 44}} />}
    </View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={ui.content}>
        <View style={ui.chapterRow}><Text style={ui.eyebrow}>{eyebrow || (stage !== undefined ? `0${stage + 1} / ${chapters[stage]}` : 'A LITTLE CLOSER')}</Text>{stage !== undefined && <View accessibilityLabel={`Stage ${stage + 1} of 4`} style={{flexDirection:'row', gap:5}}>{chapters.map((_,i)=><View key={i} style={{width:i === stage ? 24 : 5, height:5, borderRadius:3, backgroundColor:i <= stage ? rose.primary : '#49333F'}} />)}</View>}</View>
        <Text accessibilityRole="header" style={ui.title}>{title}</Text>
        {!!subtitle && <Text style={ui.subtitle}>{subtitle}</Text>}
        <View pointerEvents={busy ? 'none' : 'auto'} style={ui.body}>{children}</View>
      </ScrollView>
      {onNext && <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, 18) }]}>
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={ui.error}>{error}</Text>}
        <PrimaryButton label={action} onPress={onNext} disabled={disabled} busy={busy} />
      </View>}
    </KeyboardAvoidingView>
  </View>;
}
export function PrimaryButton({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{disabled:!!disabled || !!busy,busy:!!busy}} disabled={disabled || busy} onPress={onPress} style={({pressed})=>[ui.button,(disabled || busy)&&ui.disabled,pressed&&{transform:[{scale:0.985}]}]}>
    {busy ? <ActivityIndicator color={rose.onPrimary} /> : <><Text style={ui.buttonText}>{label}</Text><View style={ui.buttonArrow}><Ionicons name="arrow-forward" size={19} color={rose.onPrimary} /></View></>}
  </Pressable>;
}
export function Choice({ label, detail, selected, onPress, multiple, disabled, icon, index }: { label: string; detail?: string; selected?: boolean; onPress: () => void; multiple?: boolean; disabled?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name']; index?: number }) {
  return <Pressable accessibilityRole={multiple?'checkbox':'radio'} aria-checked={!!selected} accessibilityState={{checked:!!selected,disabled:!!disabled}} disabled={disabled} onPress={onPress} style={({pressed})=>[ui.choice,selected&&ui.choiceSelected,disabled&&ui.disabled,pressed&&{opacity:0.8}]}>
    {icon ? <View style={[ui.choiceIcon,selected&&{backgroundColor:'#E47CA6'}]}><Ionicons name={icon} size={22} color={selected?rose.onPrimary:rose.highlight} /></View> : index!==undefined ? <Text style={ui.optionNumber}>{String(index+1).padStart(2,'0')}</Text> : null}
    <View style={{flex:1}}><Text style={ui.choiceText}>{label}</Text>{!!detail&&<Text style={ui.detail}>{detail}</Text>}</View>
    <View style={[ui.check,selected&&{backgroundColor:rose.primary,borderColor:rose.primary}]}>{selected&&<Ionicons name="checkmark" size={14} color={rose.onPrimary} />}</View>
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const [focused,setFocused]=React.useState(false);
  return <View style={{marginBottom:14}}><Text style={ui.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={rose.hint} selectionColor={rose.primary} {...props} onFocus={e=>{setFocused(true);props.onFocus?.(e);}} onBlur={e=>{setFocused(false);props.onBlur?.(e);}} style={[ui.input,focused&&{borderColor:rose.highlight,backgroundColor:'#2D202B'},props.style]} /></View>;
}
export function CodeField(props: TextInputProps & {label: string}) {
  return <View style={{backgroundColor: '#2B1D28', borderWidth: 1, borderColor: '#745165', borderRadius: 24, padding: 20, marginBottom: 8}}><View style={{flexDirection: 'row', gap: 9, alignItems: 'center', marginBottom: 15}}><Ionicons name="mail-open-outline" size={20} color={rose.highlight}/><Text style={ui.eyebrow}>CHECK YOUR EMAIL</Text></View><Field {...props} style={[{fontSize: 30, letterSpacing: 8, textAlign: 'center', backgroundColor: '#191218', paddingVertical: 19},props.style]} /></View>;
}
export function Visibility({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <View style={ui.visibility}><Ionicons name="eye-outline" size={18} color={rose.secondary}/><Text style={[ui.detail,{flex:1,marginTop:0}]}>{label}</Text><Pressable accessibilityRole="switch" accessibilityLabel={label} aria-checked={value} accessibilityState={{checked:value}} onPress={()=>onChange(!value)} style={{width:44,minHeight:44,justifyContent:'center'}}><View style={{height:25,borderRadius:14,padding:3,backgroundColor:value?rose.primary:'#594553'}}><View style={{width:19,height:19,borderRadius:10,alignSelf:value?'flex-end':'flex-start',backgroundColor:rose.text}} /></View></Pressable></View>;
}
export function SectionLabel({ label, detail }: {label:string;detail?:string}) {
  return <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:12,marginTop:8}}><Text style={ui.eyebrow}>{label}</Text>{detail&&<Text style={[ui.detail,{marginTop:0}]}>{detail}</Text>}</View>;
}
export function Note({ children, icon='lock-closed-outline' }: {children:React.ReactNode;icon?:React.ComponentProps<typeof Ionicons>['name']}) {
  return <View style={ui.note}><Ionicons name={icon} size={17} color={rose.highlight}/><Text style={[ui.detail,{flex:1,marginTop:0}]}>{children}</Text></View>;
}
export const ui=StyleSheet.create({
  page:{flex:1,backgroundColor:rose.canvas},
  nav:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:24,minHeight:66},
  navButton:{width:44,minHeight:44,borderRadius:22,borderWidth:1,borderColor:'#48313F',alignItems:'center',justifyContent:'center'},
  monogram:{fontFamily:'CormorantGaramond_600SemiBold',fontSize:38,color:rose.highlight,width:44},
  wordmark:{fontFamily:'DMSans_500Medium',fontSize:15,letterSpacing:-0.6,color:rose.text},
  link:{fontFamily:'DMSans_700Bold',color:rose.highlight,fontSize:14},
  content:{padding:26,paddingTop:22,flexGrow:1,maxWidth:540,width:'100%',alignSelf:'center'},
  chapterRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:20,gap:12},
  eyebrow:{fontFamily:'DMSans_700Bold',fontSize:10,letterSpacing:1.7,color:rose.highlight},
  title:{fontFamily:'CormorantGaramond_600SemiBold',fontSize:47,lineHeight:48,color:rose.text,letterSpacing:-1.2},
  subtitle:{fontFamily:'DMSans_400Regular',fontSize:14,lineHeight:21,color:rose.secondary,marginTop:14,maxWidth:340},
  body:{marginTop:28,gap:10},
  footer:{paddingHorizontal:26,paddingTop:13,backgroundColor:rose.canvas},
  button:{minHeight:58,borderRadius:30,paddingLeft:24,paddingRight:10,paddingVertical:9,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:rose.primary,gap:12},
  buttonArrow:{width:38,height:38,borderRadius:20,backgroundColor:'#F0A2C0',alignItems:'center',justifyContent:'center'},
  buttonText:{fontFamily:'DMSans_700Bold',color:rose.onPrimary,fontSize:15,flexShrink:1},disabled:{opacity:0.42},
  choice:{flexDirection:'row',alignItems:'center',gap:14,backgroundColor:'#211820',borderWidth:1,borderColor:'#48333F',borderRadius:20,padding:18,minHeight:74},
  choiceSelected:{borderColor:rose.primary,backgroundColor:'#3A2432'},
  choiceIcon:{width:44,height:44,borderRadius:15,backgroundColor:'#31222D',alignItems:'center',justifyContent:'center'},
  optionNumber:{fontFamily:'CormorantGaramond_600SemiBold',fontSize:28,color:'#A57D95',width:30},
  check:{width:20,height:20,borderRadius:10,borderWidth:1,borderColor:'#876879',alignItems:'center',justifyContent:'center'},
  choiceText:{fontFamily:'DMSans_500Medium',fontSize:15,lineHeight:22,color:rose.text},
  detail:{fontFamily:'DMSans_400Regular',fontSize:13,lineHeight:20,color:rose.secondary,marginTop:4},
  label:{fontFamily:'DMSans_500Medium',fontSize:13,color:rose.secondary,marginBottom:9},
  input:{minHeight:57,borderRadius:14,borderWidth:1,borderColor:'#624655',backgroundColor:'#211820',padding:17,color:rose.text,fontFamily:'DMSans_500Medium',fontSize:16},
  error:{fontFamily:'DMSans_400Regular',color:rose.error,fontSize:13,lineHeight:19,marginBottom:12},
  visibility:{flexDirection:'row',alignItems:'center',gap:10,marginTop:12,borderTopWidth:1,borderColor:'#3D2A36',paddingTop:14},
  card:{padding:22,backgroundColor:rose.surface,borderRadius:24,borderWidth:1,borderColor:'#48313F'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:9},
  chip:{minHeight:44,paddingVertical:11,paddingHorizontal:17,borderRadius:24,borderWidth:1,borderColor:'#614654',backgroundColor:'#241B23'},
  note:{flexDirection:'row',gap:11,alignItems:'flex-start',paddingVertical:17},
});
