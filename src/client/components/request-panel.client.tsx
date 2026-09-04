import { useRpc, type PluginTheme } from "@getpaseo/plugin";
import { useRef, useState } from "react";
import { Clipboard, Text, TextInput, View } from "react-native";
import {
  buildCurl,
  type RequestOptions,
  type ProbeResult,
} from "../../shared/request.shared";
import type { TunnelEgressState } from "../../shared/tunnel-types.shared";
import { verifyEgress } from "../../shared/tunnel-rpc.shared";
import { useTranslation } from "../language.client";
import { Button, Choice, Field } from "./controls.client";

export function RequestPanel({
  entry,
  theme,
  savedToken,
}: {
  entry: TunnelEgressState;
  theme: PluginTheme;
  savedToken?: string;
}) {
  const revision = useRef(0);
  const t = useTranslation();
  const verify = useRpc(verifyEgress);
  const [origin, setOrigin] = useState(`http://127.0.0.1:${entry.listen.port}`);
  const [options, setOptions] = useState<RequestOptions>({
    path: "/",
    method: "GET",
    body: "{}",
    token: savedToken ?? "",
    bearerToken: "",
  });
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  function update(patch: Partial<RequestOptions>) {
    revision.current++;
    setOptions((current) => ({ ...current, ...patch }));
    setResult(null);
    setCopied(false);
    setCopyError(false);
    setError(false);
  }
  let curl = "";
  try {
    curl = buildCurl(origin, entry.access.mode, {
      ...options,
      token:
        options.token || (entry.access.mode !== "none" ? "<ACCESS_TOKEN>" : ""),
    });
  } catch {
    /* Show local validation below. */
  }
  const needsToken = entry.access.mode !== "none" && !options.token.trim();
  const muted = { color: theme.colors.foregroundMuted };
  return (
    <View style={{ gap: 12 }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.foreground, fontSize: 16 }}
      >
        {t("ui.curl")}
      </Text>
      <Field
        label={t("ui.origin")}
        value={origin}
        onChange={(value) => {
          setOrigin(value);
          setCopied(false);
        }}
        theme={theme}
      />
      <Field
        label={t("ui.path")}
        value={options.path}
        onChange={(path) => update({ path })}
        theme={theme}
      />
      <Choice
        label={t("ui.method")}
        value={options.method}
        options={["GET", "POST"]}
        onChange={(method) => update({ method })}
        theme={theme}
      />
      {options.method === "POST" && (
        <Field
          label={t("ui.body")}
          value={options.body}
          onChange={(body) => update({ body })}
          theme={theme}
          multiline
        />
      )}
      {entry.access.mode !== "none" && (
        <>
          <Field
            label={
              entry.access.mode === "header"
                ? "X-Paseo-Access-Token"
                : "Authorization: Bearer"
            }
            value={options.token}
            onChange={(token) => update({ token })}
            theme={theme}
            secret
          />
          <Text style={muted}>{t("ui.tokenHint")}</Text>
        </>
      )}
      {entry.access.mode !== "bearer" && (
        <Field
          label={t("ui.upstreamBearer")}
          value={options.bearerToken}
          onChange={(bearerToken) => update({ bearerToken })}
          theme={theme}
          secret
        />
      )}
      {!curl && (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger }}
        >
          {t("ui.invalidRequest")}
        </Text>
      )}
      <TextInput
        accessibilityLabel="curl"
        editable={false}
        multiline
        value={curl}
        selectTextOnFocus
        style={{
          color: theme.colors.foreground,
          padding: 12,
          borderWidth: 1,
          borderRadius: 6,
          borderColor: theme.colors.foregroundMuted,
          minHeight: 100,
          fontFamily: "monospace",
        }}
      />
      <Text style={muted}>{t("ui.testHint")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button
          title={t(copied ? "actions.copied" : "actions.copy")}
          theme={theme}
          disabled={!curl}
          onPress={() => {
            void (async () => {
              try {
                const success: unknown = await Clipboard.setString(curl);
                if (success === false) throw new Error();
                setCopied(true);
                setCopyError(false);
              } catch {
                setCopyError(true);
              }
            })();
          }}
        />
        <Button
          title={t(pending ? "ui.testing" : "ui.test")}
          variant="primary"
          theme={theme}
          disabled={pending || !curl || needsToken || !entry.enabled}
          onPress={() => {
            setPending(true);
            setError(false);
            setResult(null);
            const current = revision.current;
            void verify({ ...options, id: entry.id })
              .then((value) => {
                if (revision.current === current) setResult(value);
              })
              .catch(() => {
                if (revision.current === current) setError(true);
              })
              .finally(() => setPending(false));
          }}
        />
      </View>
      {copyError && (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger }}
        >
          {t("ui.clipboard")}
        </Text>
      )}
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger }}
        >
          {t("ui.connection")}
        </Text>
      )}
      {result && (
        <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
          <Text
            style={{
              color:
                result.error || (result.status ?? 0) >= 400
                  ? theme.colors.statusDanger
                  : theme.colors.foreground,
            }}
          >
            {result.status !== null ? `HTTP ${result.status} · ` : ""}
            {result.elapsedMs} ms
            {result.error
              ? " · " +
                t(
                  result.error === "disabled"
                    ? "status.disabled"
                    : result.error === "timeout"
                      ? "ui.timeout"
                      : "ui.connection",
                )
              : ""}
          </Text>
          <Text style={muted}>{result.contentType}</Text>
          <Text accessibilityRole="header" style={muted}>
            {t("ui.preview")}
          </Text>
          <Text
            selectable
            style={{ color: theme.colors.foreground, fontFamily: "monospace" }}
          >
            {result.preview}
          </Text>
          {result.truncated && <Text style={muted}>{t("ui.truncated")}</Text>}
        </View>
      )}
    </View>
  );
}
