import { SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { ListeningButton } from '../components/ListeningButton';
import { RecognitionResultModal } from '../components/RecognitionResultModal';
import { useSongRecognition } from '../hooks/useSongRecognition';
import { colors, fontFamilies } from '../../../theme';

export function DetectorScreen() {
  const { phase, result, error, audioLevel, startListening, cancelListening, reset } = useSongRecognition();
  const listening = phase === 'listening' || phase === 'analyzing';
  const busy = phase === 'connecting' || listening;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.screen}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>AI Music Detector</Text>
        </View>
        <View style={styles.center}>
          <View style={styles.buttonPosition}>
            <ListeningButton phase={phase} audioLevel={audioLevel} onPress={listening ? cancelListening : startListening} />
          </View>
          <View style={styles.copyPosition}>
            <Text style={styles.title}>{busy ? 'Determining if song\nis AI made' : 'Detect if it’s AI'}</Text>
            <Text style={styles.subtitle}>{phase === 'connecting' ? 'Connecting to the recognition server' : phase === 'analyzing' ? 'Checking with the recognition service' : listening ? 'Tap the button again to cancel' : 'Tap to listen to the music around you'}</Text>
            {busy && <View style={styles.listeningBadge}><View style={styles.liveDot} /><Text style={styles.badgeText}>{phase === 'connecting' ? 'CONNECTING' : phase === 'analyzing' ? 'ANALYZING AUDIO' : 'LISTENING'}</Text></View>}
          </View>
        </View>
        <View style={styles.footer}><View style={styles.footerLine} /><Text style={styles.footerText}>MADE TO DISTINGUISH BETWEEN MAN AND MACHINE</Text></View>
      </View>
      <RecognitionResultModal
        visible={(phase === 'result' && result !== null) || (phase === 'error' && error !== null && result === null)}
        result={phase === 'result' ? result : null}
        error={phase === 'error' ? error : null}
        onClose={reset}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, paddingHorizontal: 28, paddingTop: 12, paddingBottom: 24 },
  header: { alignItems: 'center', paddingTop: 9 },
  center: { flex: 1, alignItems: 'center', position: 'relative' },
  eyebrow: { color: colors.text, fontSize: 23, fontFamily: fontFamilies.bold, letterSpacing: -0.4 },
  buttonPosition: { position: 'absolute', top: '50%', marginTop: -123, alignSelf: 'center' },
  copyPosition: { position: 'absolute', top: '50%', marginTop: 143, alignItems: 'center', width: '100%' },
  title: { color: colors.text, fontSize: 28, lineHeight: 35, fontFamily: fontFamilies.bold, letterSpacing: -0.6, textAlign: 'center' },
  subtitle: { color: colors.muted, fontSize: 13, fontFamily: fontFamilies.regular, marginTop: 8, letterSpacing: 0.15, textAlign: 'center' },
  listeningBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 15, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 20, backgroundColor: colors.surface },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.lavender },
  badgeText: { color: '#cfc4e7', fontSize: 9, letterSpacing: 1.6, fontFamily: fontFamilies.bold },
  footer: { alignItems: 'center', gap: 13 },
  footerLine: { width: 34, height: 1, backgroundColor: '#645679' },
  footerText: { color: colors.footer, fontSize: 8, letterSpacing: 1.5, fontFamily: fontFamilies.semibold, textAlign: 'center' },
});
