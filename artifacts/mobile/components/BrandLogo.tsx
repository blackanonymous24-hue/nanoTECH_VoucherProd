import { Image, View, StyleSheet, type ViewStyle } from "react-native";

const LOGO = require("../assets/images/nanotech-logo.png");

type BrandLogoSize = "sm" | "md";

const SIZES: Record<BrandLogoSize, { frame: number; radius: number; scale: number }> = {
  sm: { frame: 28, radius: 8, scale: 1.28 },
  md: { frame: 36, radius: 12, scale: 1.28 },
};

interface BrandLogoProps {
  size?: BrandLogoSize;
  style?: ViewStyle;
  framed?: boolean;
}

/** Même logo que le web (`BrandLogo` + `nanotech-logo.png`). */
export function BrandLogo({ size = "sm", style, framed = true }: BrandLogoProps) {
  const s = SIZES[size];
  const imgSize = s.frame * 0.85 * s.scale;

  const img = (
    <Image
      source={LOGO}
      style={{ width: imgSize, height: imgSize }}
      resizeMode="contain"
      accessibilityLabel="nanoTECH"
    />
  );

  if (!framed) {
    return <View style={style}>{img}</View>;
  }

  return (
    <View
      style={[
        styles.frame,
        {
          width: s.frame,
          height: s.frame,
          borderRadius: s.radius,
        },
        style,
      ]}
    >
      {img}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(226, 232, 240, 0.9)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
    overflow: "hidden",
  },
});
