import React, {memo, useEffect, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {videoPosters} from './videoPosterService';
import type {VideoPoster as Poster} from './videoPosterCache';

export function useVideoPoster(uri: string) {
  const [state, setState] = useState<{source: string; poster: Poster} | null>(() => {
    const poster = videoPosters.read(uri);
    return poster ? {source: uri, poster} : null;
  });
  useEffect(() => {
    let active = true;
    void videoPosters.get(uri).then(poster => {
      if (active) setState({source: uri, poster});
    }).catch(() => {});
    return () => {active = false;};
  }, [uri]);
  return state?.source === uri ? state.poster : videoPosters.read(uri);
}

/** Cards display a still image. Modal visibility cannot restart a decoder. */
export const VideoPoster = memo(function VideoPoster({uri, fit = 'cover'}: {uri: string; fit?: 'cover' | 'contain'}) {
  return <View style={s.frame} accessible={false}>
    <Ionicons name="videocam-outline" size={25} color="#9A657D"/>
    {!!uri && fit === 'contain' && <Image source={{uri}} style={[StyleSheet.absoluteFill, {opacity: 0.35}]} resizeMode="cover" blurRadius={18} fadeDuration={0}/>}
    {!!uri && <Image source={{uri}} style={StyleSheet.absoluteFill} resizeMode={fit} fadeDuration={0}/>}
  </View>;
});
const s = StyleSheet.create({frame: {...StyleSheet.absoluteFill, alignItems:'center', justifyContent:'center', backgroundColor:'#EEDFE5'}});
