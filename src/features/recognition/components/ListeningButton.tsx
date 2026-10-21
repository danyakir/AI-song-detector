import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import type { RecognitionPhase } from '../recognition.types';
import { colors } from '../../../theme';

type Props = {
  phase: RecognitionPhase;
  audioLevel: number;
  onPress: () => void;
};

export function ListeningButton({ phase, audioLevel, onPress }: Props) {
  const heartbeat = useRef(new Animated.Value(1)).current;
  const audioPulse = useRef(new Animated.Value(1)).current;
  const previousLevel = useRef(0);
  const active = phase === 'connecting' || phase === 'listening' || phase === 'analyzing';
  const useNativeDriver = Platform.OS !== 'web';

  useEffect(() => {
    heartbeat.stopAnimation();
    heartbeat.setValue(1);

    if (phase === 'listening') {
      const listeningBeat = Animated.loop(Animated.sequence([
        Animated.timing(heartbeat, { toValue: 1.045, duration: 360, easing: Easing.out(Easing.quad), useNativeDriver }),
        Animated.timing(heartbeat, { toValue: 1, duration: 440, easing: Easing.inOut(Easing.ease), useNativeDriver }),
        Animated.delay(180),
      ]));
      listeningBeat.start();
      return () => listeningBeat.stop();
    }

    if (active) {
      return;
    }

    const idleBeat = Animated.loop(Animated.sequence([
      Animated.timing(heartbeat, { toValue: 1.09, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver }),
      Animated.timing(heartbeat, { toValue: 1, duration: 190, easing: Easing.inOut(Easing.ease), useNativeDriver }),
      Animated.delay(115),
      Animated.timing(heartbeat, { toValue: 1.055, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver }),
      Animated.timing(heartbeat, { toValue: 1, duration: 230, easing: Easing.inOut(Easing.ease), useNativeDriver }),
      Animated.delay(760),
    ]));
    idleBeat.start();
    return () => idleBeat.stop();
  }, [active, heartbeat, phase, useNativeDriver]);

  useEffect(() => {
    if (phase !== 'listening') {
      previousLevel.current = 0;
      audioPulse.setValue(1);
      return;
    }

    const hasBeat = audioLevel - previousLevel.current > 0.04 && audioLevel > 0.06;
    previousLevel.current = audioLevel;
    const scale = 1 + Math.min(audioLevel, 1) * 0.1 + (hasBeat ? 0.07 : 0);
    Animated.spring(audioPulse, {
      toValue: scale,
      speed: hasBeat ? 30 : 22,
      bounciness: hasBeat ? 12 : 5,
      useNativeDriver,
    }).start();
  }, [audioLevel, audioPulse, phase, useNativeDriver]);

  const listening = active;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={phase === 'connecting' ? 'Connecting to recognition server' : listening ? 'Cancel listening' : 'Start listening'}
      accessibilityHint={listening ? 'Stops recording and cancels recognition' : undefined}
      disabled={phase !== 'ready' && phase !== 'listening'}
      onPress={onPress}
    >
      <Animated.View style={{ transform: [{ scale: heartbeat }] }}>
        <Animated.View style={{ transform: [{ scale: audioPulse }] }}>
          <Animated.View style={[styles.orbit, listening && styles.orbitActive]}>
            <View style={styles.button}><SearchWaveIcon /></View>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

function SearchWaveIcon() {
  return (
    <View style={styles.iconFrame}>
      <View style={styles.handle} />
      <View style={styles.lens}>
        <View style={styles.waveform}>
          {[18, 34, 50, 34, 18].map((height, index) => (
            <View key={index} style={[styles.waveBar, { height }]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  orbit: { width: 246, height: 246, borderRadius: 123, borderWidth: 1, borderColor: 'rgba(206,184,255,0.17)', justifyContent: 'center', alignItems: 'center' },
  orbitActive: { borderColor: 'rgba(206,184,255,0.55)' },
  button: { width: 196, height: 196, borderRadius: 98, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center', shadowColor: '#b99aff', shadowOpacity: 0.38, shadowRadius: 42, shadowOffset: { width: 0, height: 0 }, elevation: 14 },
  iconFrame: { width: 138, height: 138 },
  handle: { position: 'absolute', zIndex: 0, left: 96, top: 88, width: 16, height: 54, borderRadius: 8, backgroundColor: colors.ink, transform: [{ rotate: '-45deg' }] },
  lens: { position: 'absolute', zIndex: 1, left: 5, top: 4, width: 108, height: 108, borderWidth: 8, borderColor: colors.ink, borderRadius: 54, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lavender },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  waveBar: { width: 8, borderRadius: 5, backgroundColor: '#7656bd' },
});
