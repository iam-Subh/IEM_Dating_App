import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, StatusBar, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, Mask, Rect, Stop, LinearGradient as SvgGradient, Image as SvgImage } from 'react-native-svg';
import { GoogleMark } from '../onboarding/GoogleMark';
import { ui } from '../onboarding/OnboardingFrame';
// Keep both first-page palettes for the theme review.
const welcomePalettes = {
  light: {
    canvas: '#F4E3E8', top: '#F5CDDA', middle: '#F1D8E1',
    text: '#352335', secondary: '#665065', border: '#A5819C',
    primary: '#712C48', onPrimary: '#FFF7FA', buttonInset: '#8B405C', emailBackground: '#E5C4D1',
  },
  dark: {
    canvas: '#30232E', top: '#684052', middle: '#493142',
    text: '#FFF2F5', secondary: '#C8B6C1', border: '#765362',
    primary: '#E8AEC3', onPrimary: '#3C2030', buttonInset: '#F3C7D7', emailBackground: '#553748',
  },
};
const welcome = welcomePalettes.light;
export const WelcomeScreen=()=>{
  const navigation=useNavigation<any>(),insets=useSafeAreaInsets();
  const {width,height}=useWindowDimensions();
  const compact=height-insets.top-insets.bottom<700;
  const artSize=Math.max(0,Math.min(width*0.80,320,height-insets.top-insets.bottom-(compact?320:370)));
  const headingSize=Math.min(compact?36:43,(width-52)/7.4);
  return <LinearGradient colors={[welcome.top,welcome.middle,welcome.canvas]} locations={[0,0.48,1]} style={{flex:1}}>
    <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent/>
    <View style={[s.content,{paddingTop:insets.top+12,paddingBottom:insets.bottom+12}]}>
      <View style={[s.art,{marginBottom:compact?12:24}]}><View style={[s.artScene,{height:artSize}]}><Image source={require("../../../../assets/illustrations/welcome-floating-heart-3d.png")} style={s.heartLeft} blurRadius={3} resizeMode="contain" accessible={false}/><Image source={require("../../../../assets/illustrations/welcome-floating-heart-3d.png")} style={s.heartRight} blurRadius={4} resizeMode="contain" accessible={false}/><Svg width={artSize} height={artSize} accessible={false}>
        <Defs>
          <SvgGradient id="coupleFade" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor="white" stopOpacity={1}/>
            <Stop offset="0.87" stopColor="white" stopOpacity={1}/>
            <Stop offset="0.94" stopColor="white" stopOpacity={0.80}/>
            <Stop offset="0.98" stopColor="white" stopOpacity={0}/>
          </SvgGradient>
          <Mask id="coupleMask" x="0" y="0" width="100%" height="100%">
            <Rect width={artSize} height={artSize} fill="url(#coupleFade)"/>
          </Mask>
        </Defs>
        <SvgImage href={require("../../../../assets/illustrations/welcome-couple-3d.png")} width={artSize} height={artSize} preserveAspectRatio="xMidYMid meet" mask="url(#coupleMask)"/>
      </Svg></View></View>
      <Text accessibilityRole="header" style={[s.title,{fontSize:headingSize,lineHeight:headingSize+4}]}>Someone new.{'\n'}Something real.</Text>
      <Text style={s.subtitle}>Meet people from your college.{ '\n'}Start with a little about you.</Text>
      <View style={[s.actions,compact&&{gap:8,marginTop:18}]}>
        <Pressable accessibilityRole="button" onPress={()=>navigation.navigate('SignUp')} style={s.email}><Ionicons name="mail-outline" size={18} color={welcome.onPrimary}/><Text style={s.emailText}>Use college email</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>navigation.navigate('Login',{initialMethod:'google'})} style={({pressed})=>[s.primary,pressed&&{opacity:0.9}]}><View style={s.googleLabel}><View style={s.googleIcon}><GoogleMark size={18}/></View><Text style={s.primaryText}>Continue with Google</Text></View><View style={s.arrow}><Ionicons name="arrow-forward" size={19} color={welcome.text}/></View></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>navigation.navigate('Login',{initialForm:'email'})} style={s.signin}><Text style={[ui.detail,{color:welcome.secondary}]}>Already here? <Text style={[ui.link,{color:welcome.text}]}>Sign in</Text></Text></Pressable>
        {/* Before an account exists: what joining means (docs/SAFETY_AND_LEGAL.md 6). */}
        <Text style={[ui.detail,{color:welcome.secondary,textAlign:'center',fontSize:11,lineHeight:16,marginTop:6}]}>18+ only. By continuing you agree to our <Text accessibilityRole="link" style={{color:welcome.text,textDecorationLine:'underline'}} onPress={()=>navigation.navigate('Legal',{slug:'terms'})}>Terms</Text> and <Text accessibilityRole="link" style={{color:welcome.text,textDecorationLine:'underline'}} onPress={()=>navigation.navigate('Legal',{slug:'privacy'})}>Privacy Policy</Text>.</Text>
      </View>
    </View>
  </LinearGradient>;
};
const s=StyleSheet.create({
  content:{flex:1,paddingHorizontal:26,maxWidth:540,width:'100%',alignSelf:'center'},
  art:{marginTop:8,marginBottom:24,marginHorizontal:-26,minHeight:0,overflow:'hidden',flex:1,justifyContent:'center'},
  artScene:{width:"100%",alignItems:"center",justifyContent:"center"},
  heartLeft:{position:"absolute",width:86,height:86,left:"4%",top:15,opacity:0.65,transform:[{rotate:"-22deg"}]},
  heartRight:{position:"absolute",width:72,height:72,right:"3%",top:62,opacity:0.55,transform:[{rotate:"18deg"}]},
  title:{textAlign:'center',fontFamily:'CormorantGaramond_600SemiBold',fontSize:43,lineHeight:47,paddingBottom:6,includeFontPadding:true,letterSpacing:-1.1,color:welcome.text},
  subtitle:{textAlign:'center',fontFamily:'DMSans_400Regular',fontSize:14,lineHeight:22,color:welcome.secondary,marginTop:12},
  actions:{gap:12,marginTop:28},
  primary:{minHeight:58,borderRadius:30,paddingLeft:50,paddingRight:50,paddingVertical:9,flexDirection:'row',alignItems:'center',justifyContent:'center',backgroundColor:welcome.emailBackground,gap:12},
  googleLabel:{flexDirection:'row',alignItems:'center',gap:9},
  googleIcon:{width:26,height:26,borderRadius:13,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},
  primaryText:{fontFamily:'DMSans_700Bold',fontSize:14,color:welcome.text},
  arrow:{position:"absolute",right:10,width:38,height:38,borderRadius:20,backgroundColor:'#DAB2C2',alignItems:'center',justifyContent:'center'},
  emailText:{fontFamily:'DMSans_700Bold',fontSize:15,color:welcome.onPrimary},
  email:{minHeight:58,borderRadius:30,backgroundColor:welcome.primary,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:10},signin:{marginTop:4,minHeight:42,alignItems:'center',justifyContent:'center'},
});
