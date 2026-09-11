import type { PluginTheme } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

export function Button({
  title,
  onPress,
  theme,
  disabled = false,
  variant = "outline",
}: {
  title: string;
  onPress: () => void;
  theme: PluginTheme;
  disabled?: boolean;
  variant?: "outline" | "primary" | "ghost" | "danger";
}) {
  const filled = variant === "primary" || variant === "danger";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        minHeight: 44,
        justifyContent: "center",
        borderWidth: variant === "outline" ? 1 : 0,
        borderColor: theme.colors.foregroundMuted,
        backgroundColor:
          variant === "primary"
            ? theme.colors.accent
            : variant === "danger"
              ? theme.colors.statusDanger
              : undefined,
        borderRadius: 6,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: filled
            ? theme.colors.accentForeground
            : theme.colors.foreground,
          fontSize: 14,
          fontWeight: filled ? "500" : "400",
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChange,
  theme,
  multiline = false,
  secret = false,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  theme: PluginTheme;
  multiline?: boolean;
  secret?: boolean;
  numeric?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        multiline={multiline}
        secureTextEntry={secret}
        keyboardType={numeric ? "number-pad" : "default"}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{
          color: theme.colors.foreground,
          fontSize: 14,
          borderColor: focused
            ? theme.colors.accent
            : theme.colors.foregroundMuted,
          borderWidth: 1,
          borderRadius: 6,
          padding: 12,
          minHeight: multiline ? 100 : 44,
          textAlignVertical: "top",
        }}
      />
    </View>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  theme,
  labels,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  theme: PluginTheme;
  labels?: Partial<Record<T, string>>;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <Button
            key={option}
            title={`${option === value ? "✓ " : ""}${labels?.[option] ?? option}`}
            onPress={() => onChange(option)}
            theme={theme}
          />
        ))}
      </View>
    </View>
  );
}
