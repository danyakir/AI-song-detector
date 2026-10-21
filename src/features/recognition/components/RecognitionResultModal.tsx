import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RecognitionResult } from '../recognition.types';
import { colors, fontFamilies } from '../../../theme';

type Props = {
  visible: boolean;
  result: RecognitionResult | null;
  error: string | null;
  onClose: () => void;
};

function AnonymousIcon() {
  return (
    <View style={styles.anonymousIcon}>
      <View style={styles.hatCrown} />
      <View style={styles.hatBrim} />
      <View style={styles.head} />
      <View style={styles.shoulders} />
      <View style={styles.leftLens} />
      <View style={styles.rightLens} />
      <View style={styles.glassesBridge} />
    </View>
  );
}

export function RecognitionResultModal({ visible, result, error, onClose }: Props) {
  if (!visible) return null;

  const isAi = result?.classification === 'ai';
  const isHuman = result?.classification === 'human';
  const setupError = error?.includes('AUDD_API_TOKEN')
    ? 'Add your AudD API token to the project’s .env file, then restart the recognition server with npm run server.'
    : error?.includes('ACRCLOUD_API_TOKEN')
      ? 'Add your ACRCloud console API token to the project’s .env file, then restart the recognition server with npm run server.'
      : null;
  const serverDown = error?.toLowerCase().includes('server is down') || error?.toLowerCase().includes("can't connect to the recognition server");
  const title = result
    ? (isAi ? 'AI-made song' : isHuman ? 'Human-made song' : 'Couldn’t identify the song')
    : setupError ? 'Recognition setup required' : serverDown ? 'Server is down' : 'Recognition unavailable';
  const copy = result
    ? (isAi
      ? `${result.title ? `${result.title}\n${result.artist ?? ''}\n` : ''}This track was identified as AI-made${result.generator ? `, likely using ${result.generator}.` : '.'}`
      : isHuman
        ? `${result.title}\n${result.artist}`
        : result.title
          ? `${result.title}\n${result.artist ?? ''}\nWe identified the song, but ACRCloud couldn’t return a usable AI verdict.`
          : 'We couldn’t identify this track or determine how it was made.')
    : setupError ?? error;

  return (
    <View style={styles.scrim} accessibilityViewIsModal>
      <View style={styles.dialog}>
        {result && result.classification !== 'unknown' && (
          <View style={[styles.resultMark, { backgroundColor: isAi ? colors.ai : colors.human }]}>
            {isAi ? <AnonymousIcon /> : <Text style={styles.resultIcon}>🎉</Text>}
          </View>
        )}
        <Text style={styles.eyebrow}>{result ? 'ANALYSIS COMPLETE' : 'TRY AGAIN LATER'}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.copy}>{copy}</Text>
        <Pressable style={styles.doneButton} onPress={onClose}><Text style={styles.doneText}>Done</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 1000, backgroundColor: 'rgba(8,6,13,0.74)', justifyContent: 'center', alignItems: 'center', padding: 26 },
  dialog: { width: '100%', maxWidth: 360, backgroundColor: colors.panel, borderRadius: 30, alignItems: 'center', paddingHorizontal: 26, paddingTop: 32, paddingBottom: 24 },
  resultMark: { width: 66, height: 66, borderRadius: 33, justifyContent: 'center', alignItems: 'center', marginBottom: 19 },
  resultIcon: { fontSize: 36 },
  anonymousIcon: { width: 54, height: 50, alignItems: 'center' },
  hatCrown: { position: 'absolute', top: 0, width: 34, height: 20, borderTopLeftRadius: 17, borderTopRightRadius: 17, backgroundColor: colors.ink },
  hatBrim: { position: 'absolute', top: 16, width: 52, height: 7, borderRadius: 4, backgroundColor: colors.ink },
  head: { position: 'absolute', top: 19, width: 31, height: 27, borderTopLeftRadius: 13, borderTopRightRadius: 13, borderBottomLeftRadius: 15, borderBottomRightRadius: 15, backgroundColor: colors.ink },
  shoulders: { position: 'absolute', bottom: 0, width: 43, height: 10, borderTopLeftRadius: 21, borderTopRightRadius: 21, backgroundColor: colors.ink },
  leftLens: { position: 'absolute', top: 29, left: 13, width: 11, height: 7, borderRadius: 4, backgroundColor: colors.panel },
  rightLens: { position: 'absolute', top: 29, right: 13, width: 11, height: 7, borderRadius: 4, backgroundColor: colors.panel },
  glassesBridge: { position: 'absolute', top: 31, width: 6, height: 2, backgroundColor: colors.panel },
  eyebrow: { color: colors.mutedDark, fontSize: 9, letterSpacing: 2.2, fontFamily: fontFamilies.bold },
  title: { color: colors.ink, fontSize: 25, fontFamily: fontFamilies.bold, letterSpacing: -0.5, marginTop: 11, textAlign: 'center' },
  copy: { color: colors.mutedDark, fontSize: 13, fontFamily: fontFamilies.regular, textAlign: 'center', lineHeight: 20, marginTop: 9, marginBottom: 24 },
  doneButton: { width: '100%', borderRadius: 15, backgroundColor: colors.lavender, alignItems: 'center', paddingVertical: 14 },
  doneText: { color: colors.ink, fontSize: 14, fontFamily: fontFamilies.bold },
});
