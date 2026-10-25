import React, {useRef, useState} from 'react';
import {View, Text, Pressable, TextInput, TextInputProps, StyleSheet, StatusBar, KeyboardAvoidingView, ScrollView, Platform, ActivityIndicator, StyleProp, TextStyle, ViewStyle} from 'react-native';
import {LinearGradient} from 'expo-linear-gradient';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Ionicons} from '@expo/vector-icons';
import Svg, {Path} from 'react-native-svg';

export function AuthEntryFrame({title,subtitle,onBack,children,footer,titleStyle,headingStyle,subtitleStyle,headingGraphic,colors=['#F5CDDA','#F1D8E1','#F4E3E8']}: {
  title:string; subtitle:string; onBack:()=>void; children:React.ReactNode; footer:React.ReactNode; colors?:[string,string,string]; titleStyle?:StyleProp<TextStyle>; headingStyle?:StyleProp<ViewStyle>; subtitleStyle?:StyleProp<TextStyle>; headingGraphic?:React.ReactNode;
}) {
  const insets=useSafeAreaInsets();
  return <LinearGradient colors={colors} locations={[0,0.48,1]} style={{flex:1}}>
    <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent/>
    <View style={[auth.nav,{paddingTop:insets.top+8}]}><Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={auth.back}><Ionicons name="arrow-back" size={22} color="#352335"/></Pressable></View>
    <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[auth.content,{paddingBottom:insets.bottom+24}]}>
        {headingGraphic}
        <View style={[auth.heading,headingStyle]}><Text accessibilityRole="header" style={[auth.title,titleStyle]}>{title}</Text><Text style={[auth.subtitle,subtitleStyle]}>{subtitle}</Text></View>
        <View style={auth.form}>{children}</View>
        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  </LinearGradient>;
}

export function AuthField({label,suffix,onToggle,visible,icon,...props}: TextInputProps & {label:string;suffix?:string;onToggle?:()=>void;visible?:boolean;icon?:React.ComponentProps<typeof Ionicons>['name']}) {
  const [focused,setFocused]=useState(false);
  const inputRef=useRef<TextInput>(null);
  const floating=focused||!!props.value||!!props.defaultValue;
  const [width,setWidth]=useState(0);
  const [labelWidth,setLabelWidth]=useState(0);
  const floatingLeft=39;
  const gapStart=floating?floatingLeft:width/2;
  const gapEnd=floating?floatingLeft+labelWidth:width/2;
  return <View style={auth.field}><Pressable onLayout={e=>setWidth(e.nativeEvent.layout.width)} onPress={()=>inputRef.current?.focus()} accessible={false} style={[auth.inputBox,focused&&auth.inputFocused]}>
    {width>60&&<Svg pointerEvents="none" width={width} height={60} style={StyleSheet.absoluteFill}>
      <Path d={`M ${gapStart} 0.75 H 30 A 29.25 29.25 0 0 0 0.75 30 A 29.25 29.25 0 0 0 30 59.25 H ${width-30} A 29.25 29.25 0 0 0 ${width-0.75} 30 A 29.25 29.25 0 0 0 ${width-30} 0.75 H ${gapEnd}`} fill="none" stroke={focused?'#A65B7A':'#FFFFFF90'} strokeWidth={1.5}/>
    </Svg>}
    <Ionicons name={icon||(suffix?'mail-outline':'lock-closed-outline')} size={21} color={focused?'#712C48':'#977284'}/>
    <Text onLayout={e=>setLabelWidth(e.nativeEvent.layout.width)} pointerEvents="none" accessible={false} style={[auth.label,floating&&auth.labelFloating,focused&&{color:'#712C48'}]}>{label}</Text>
    <View style={auth.inputContent}><View style={auth.inputRow}>
    <TextInput {...props} ref={inputRef} multiline={false} placeholder={floating?props.placeholder:undefined} accessibilityLabel={label} placeholderTextColor="#9A8190" selectionColor="#712C48" style={[auth.input,props.style]} onFocus={e=>{setFocused(true);props.onFocus?.(e);}} onBlur={e=>{setFocused(false);props.onBlur?.(e);}}/>
    {suffix&&<Text numberOfLines={1} style={auth.suffix}>{suffix}</Text>}</View></View>
    {onToggle&&<Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={visible?'Hide password':'Show password'} style={auth.eye}><Ionicons name={visible?'eye-off-outline':'eye-outline'} size={21} color="#715365"/></Pressable>}
  </Pressable></View>;
}

export function AuthAction({label,onPress,disabled,busy,backgroundColor='#712C48',disabledBackgroundColor}: {label:string;onPress:()=>void;disabled?:boolean;busy?:boolean;backgroundColor?:string;disabledBackgroundColor?:string}) {
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{disabled:!!disabled||!!busy,busy:!!busy}} disabled={disabled||busy} style={({pressed})=>[auth.action,{backgroundColor},(disabled||busy)&&(disabledBackgroundColor?{backgroundColor:disabledBackgroundColor}:{opacity:0.45}),pressed&&{opacity:0.8}]}>
    {busy?<ActivityIndicator color="#FFF7FA"/>:<><Text style={auth.actionText}>{label}</Text><Ionicons name="arrow-forward" size={20} color="#FFF7FA"/></>}
  </Pressable>;
}

export const auth=StyleSheet.create({
  nav:{paddingHorizontal:22},back:{width:44,height:44,borderRadius:22,backgroundColor:'#FFFFFF65',alignItems:'center',justifyContent:'center'},
  content:{flexGrow:1,paddingHorizontal:24,paddingTop:26,maxWidth:540,width:'100%',alignSelf:'center'},
  heading:{marginBottom:36},title:{fontFamily:'CormorantGaramond_600SemiBold',fontSize:44,lineHeight:47,letterSpacing:-1,color:'#352335'},
  subtitle:{fontFamily:'DMSans_400Regular',fontSize:14,lineHeight:21,color:'#715365',marginTop:10},
  form:{gap:2},
  field:{marginBottom:14},label:{position:'absolute',left:41,top:20,fontFamily:'DMSans_500Medium',fontSize:14,lineHeight:20,color:'#8A6578',zIndex:1},
  labelFloating:{top:-9,left:39,fontSize:11,lineHeight:18,paddingHorizontal:2},
  inputBox:{height:60,borderRadius:30,backgroundColor:'#FFFFFFCC',flexDirection:'row',alignItems:'center',paddingHorizontal:12,gap:8},
  inputFocused:{backgroundColor:'#FFFFFF'},
  inputContent:{flex:1,minWidth:0},inputRow:{flexDirection:'row',alignItems:'center'},
  input:{flex:1,minWidth:0,height:48,paddingVertical:0,fontFamily:'DMSans_500Medium',fontSize:15,color:'#352335'},
  emailInput:{fontSize:15},
  suffix:{fontFamily:'DMSans_500Medium',fontSize:12,color:'#715365',marginLeft:4,flexShrink:0},eye:{width:36,minHeight:44,alignItems:'center',justifyContent:'center'},
  hint:{fontFamily:'DMSans_400Regular',fontSize:12,lineHeight:18,color:'#8A6B7D',marginTop:-9,marginBottom:22,paddingHorizontal:18},
  passwordRule:{fontFamily:'DMSans_400Regular',fontSize:12,lineHeight:18,color:'#715365',marginTop:-6,marginBottom:16,paddingHorizontal:18},
  passwordRuleMet:{color:'#39644F'},
  link:{fontFamily:'DMSans_700Bold',fontSize:13,color:'#712C48'},utility:{alignSelf:'flex-end',height:32,justifyContent:'center',marginTop:-10,marginBottom:-4},
  action:{marginTop:8,minHeight:56,borderRadius:28,backgroundColor:'#712C48',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:12,paddingHorizontal:16},actionText:{fontFamily:'DMSans_700Bold',fontSize:15,color:'#FFF7FA'},
  error:{fontFamily:'DMSans_400Regular',fontSize:13,lineHeight:19,color:'#AE2646',marginBottom:14},
  fieldError:{fontFamily:'DMSans_400Regular',fontSize:12,lineHeight:18,color:'#AE2646',marginTop:-6,marginBottom:14,paddingHorizontal:18},
  divider:{flexDirection:'row',alignItems:'center',gap:12,marginVertical:12},line:{flex:1,height:1,backgroundColor:'#DABAC9'},or:{fontFamily:'DMSans_400Regular',fontSize:12,color:'#8A6B7D'},
  google:{minHeight:56,borderRadius:28,borderWidth:1,borderColor:'#DDBECC',backgroundColor:'#FFFFFF',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:12},googleActive:{backgroundColor:'#E9E1D9',borderColor:'#BCAEA5'},googleText:{fontFamily:'DMSans_700Bold',fontSize:14,color:'#352335'},
  switch:{minHeight:48,alignItems:'center',justifyContent:'center',marginTop:22},switchText:{fontFamily:'DMSans_400Regular',fontSize:13,color:'#715365'},
  switchCompact:{minHeight:44,marginTop:4},
});
