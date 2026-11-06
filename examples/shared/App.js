// Shared by every example (bare, expo, repack). Imports are written the way apps usually write
// them: named imports from big libraries and from a local barrel. Strings starting with
// `PROBE_USED_` must stay in the bundle, `PROBE_UNUSED_` ones should be tree-shaken.
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { Heart, Star } from 'lucide-react-native';
import { format } from 'date-fns';
import { debounce } from 'lodash-es';

import { Badge, PRIMARY, formatPrice } from './ui';

export default function App() {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onPress = useMemo(
    () =>
      debounce(() => {
        scale.value = withSpring(scale.value === 1 ? 1.2 : 1);
      }, 50),
    [scale]
  );

  return (
    <View style={styles.container}>
      <Text>{format(new Date(2026, 10, 6), 'yyyy-MM-dd')}</Text>
      <Badge label={formatPrice(42)} />
      <Pressable onPress={onPress}>
        <Animated.View style={animatedStyle}>
          <Svg width={64} height={64} viewBox="0 0 64 64">
            <Circle cx={32} cy={32} r={30} fill={PRIMARY} />
            <Path d="M20 32 L44 32" stroke="white" strokeWidth={4} />
          </Svg>
        </Animated.View>
      </Pressable>
      <View style={styles.row}>
        <Heart color={PRIMARY} />
        <Star color={PRIMARY} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', flex: 1, gap: 16, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 8 },
});
