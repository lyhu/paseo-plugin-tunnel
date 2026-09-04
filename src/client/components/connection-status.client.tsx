import type { PluginTheme } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { Connectivity } from "../../shared/tunnel-types.shared";
import { useTranslation } from "../language.client";

export function ConnectionStatus({
  connectivity,
  enabled,
  failed,
  theme,
}: {
  connectivity?: Connectivity;
  enabled: boolean;
  failed: boolean;
  theme: PluginTheme;
}) {
  const t = useTranslation();
  const online = enabled && !failed && connectivity?.state === "online";
  const checking =
    enabled && !failed && (!connectivity || connectivity.state === "checking");
  const label = !enabled
    ? t("status.disabled")
    : online
      ? t("health.online")
      : checking
        ? t("health.checking")
        : t("health.offline");
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: online ? "#22c55e" : "#eab308",
        }}
      />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
        {label}
        {online && connectivity?.httpStatus
          ? ` · HTTP ${connectivity.httpStatus}`
          : ""}
      </Text>
    </View>
  );
}
