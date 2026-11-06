import React from 'react';
import { Text, View } from 'react-native';
// Only used by `UnusedCard`: once it's removed, `Rect` and `Polygon` should go too.
import Svg, { Polygon, Rect } from 'react-native-svg';

export function Badge({ label }) {
  return (
    <View accessibilityHint="PROBE_USED_Badge">
      <Text>{label}</Text>
    </View>
  );
}

export function UnusedCard({ title }) {
  return (
    <View accessibilityHint="PROBE_UNUSED_UnusedCard">
      <Text>{title}</Text>
      <Svg width={10} height={10}>
        <Rect width={10} height={10} />
        <Polygon points="0,0 10,0 5,10" />
      </Svg>
    </View>
  );
}
