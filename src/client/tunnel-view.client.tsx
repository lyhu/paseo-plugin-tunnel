import { routeOfferPreview } from "./route-offer-preview.shared";
import { RequestPanel } from "./components/request-panel.client";
import type { TunnelState } from "../shared/tunnel-types.shared";
import { useTranslation, LanguageProvider } from "./language.client";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useReducer, useState } from "react";
import {
  Clipboard,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Rpc from "../shared/tunnel-rpc.shared";
import { Button } from "./components/controls.client";
import {
  type FormValues,
  type RuleForm,
  RuleFormView,
} from "./forms/rule-form.client";

type Dialog =
  | { kind: "form"; form: RuleForm }
  | {
      kind: "secret";
      credential: "route-offer" | "access-token";
      title: string;
      value: string;
      copied: boolean;
      hint?: string;
    }
  | {
      kind: "confirm";
      title: string;
      description: string;
      run: () => Promise<void>;
    }
  | null;

export function TunnelView(props: PluginSurfaceProps) {
  return (
    <LanguageProvider>
      <TunnelHostView key={props.host.id} {...props} />
    </LanguageProvider>
  );
}

function TunnelHostView({ theme, layout, host }: PluginSurfaceProps) {
  const t = useTranslation();
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const getState = useRpc(Rpc.getTunnelState);
  const createIngress = useRpc(Rpc.createIngress);
  const updateIngress = useRpc(Rpc.updateIngress);
  const deleteIngress = useRpc(Rpc.deleteIngress);
  const rotateIngress = useRpc(Rpc.rotateIngressSecret);
  const exportOffer = useRpc(Rpc.exportRouteOffer);
  const createEgress = useRpc(Rpc.createEgress);
  const updateEgress = useRpc(Rpc.updateEgress);
  const deleteEgress = useRpc(Rpc.deleteEgress);
  const replaceOffer = useRpc(Rpc.replaceEgressOffer);
  const rotateToken = useRpc(Rpc.rotateEgressToken);
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useReducer(
    (_state: Dialog, next: Dialog) => next,
    null,
  );
  const [expanded, expand] = useReducer(
    (_current: string | null, next: string | null) => next,
    null,
  );
  const queryKey = ["tunnel-state", host.id];
  const state = useQuery({
    queryKey,
    queryFn: () => getState({}),
    refetchInterval: 5000,
  });
  const action = useMutation({
    mutationFn: (run: () => Promise<void>) => run(),
    retry: false,
    gcTime: 0,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const text = { color: theme.colors.foreground };
  const muted = { color: theme.colors.foregroundMuted };
  const row = {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    gap: 8,
  };
  const card = {
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted,
    borderRadius: 8,
    gap: 12,
  };

  function open(form: RuleForm) {
    action.reset();
    setDialog({ kind: "form", form });
  }
  function close() {
    action.reset();
    setDialog(null);
  }
  function confirm(
    title: string,
    description: string,
    run: () => Promise<void>,
  ) {
    action.reset();
    setDialog({ kind: "confirm", title, description, run });
  }
  function submit(form: RuleForm, value: FormValues) {
    action.mutate(async () => {
      let result: { oneTimeToken?: string; state: TunnelState };
      const listen = { host: value.host, port: Number(value.port) };
      switch (form.kind) {
        case "create-ingress":
          result = await createIngress({
            name: value.name,
            targetOrigin: value.targetOrigin,
          });
          break;
        case "edit-ingress":
          result = await updateIngress({
            id: form.entry.id,
            name: value.name,
            targetOrigin: value.targetOrigin,
          });
          break;
        case "create-egress":
          result = await createEgress({
            name: value.name,
            listen,
            offerString: value.offerString,
            accessMode: value.mode,
            customToken: value.token || undefined,
          });
          break;
        case "edit-egress":
          result = await updateEgress({
            id: form.entry.id,
            name: value.name,
            listen,
          });
          break;
        case "replace-offer":
          result = await replaceOffer({
            id: form.entry.id,
            offerString: value.offerString,
          });
          break;
        case "rotate-token":
          result = await rotateToken({
            id: form.entry.id,
            mode: value.mode,
            token: value.token || undefined,
          });
          break;
      }
      if (form.kind === "create-egress" || form.kind === "rotate-token") {
        const id =
          form.kind === "rotate-token"
            ? form.entry.id
            : result.state.egresses.find(
                (entry) =>
                  !state.data?.egresses.some(
                    (previous) => previous.id === entry.id,
                  ),
              )?.id;
        if (id) {
          setTesting(null);
          const token = result.oneTimeToken;
          setTokens((current) => {
            const next = { ...current };
            if (token) next[id] = token;
            else delete next[id];
            return next;
          });
        }
      }
      setDialog(
        result.oneTimeToken
          ? {
              kind: "secret",
              credential: "access-token",
              title: t("result.title"),
              value: result.oneTimeToken,
              copied: false,
              hint:
                value.mode === "bearer"
                  ? "Authorization: Bearer <token>"
                  : "X-Paseo-Access-Token: <token>",
            }
          : null,
      );
    });
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{
        padding: layout.compact ? 16 : 24,
        gap: 24,
        width: "100%",
        maxWidth: 760,
        alignSelf: "center",
      }}
    >
      <Text
        accessibilityRole="header"
        style={{ ...text, fontSize: 20, fontWeight: "500" }}
      >
        HTTP Tunnel
      </Text>
      <Text style={{ ...muted, lineHeight: 21 }}>
        {t("labels.targetOrigin")} → Ingress → Relay → Egress
      </Text>
      {dialog ? (
        <View style={{ gap: 20 }}>
          {dialog.kind === "form" && (
            <RuleFormView
              key={dialog.form.kind}
              form={dialog.form}
              theme={theme}
              pending={action.isPending}
              error={friendlyError(action.error)}
              onSubmit={(value) => submit(dialog.form, value)}
              onCancel={close}
            />
          )}
          {dialog.kind === "confirm" && (
            <>
              <Text
                accessibilityRole="header"
                style={{ ...text, fontSize: 20 }}
              >
                {dialog.title}
              </Text>
              <Text style={muted}>{dialog.description}</Text>
              {action.error && (
                <Text
                  accessibilityRole="alert"
                  style={{ color: theme.colors.statusDanger }}
                >
                  {friendlyError(action.error)}
                </Text>
              )}
              <View style={row}>
                <Button
                  variant="danger"
                  title={
                    action.isPending
                      ? t("actions.saving")
                      : t("actions.continue")
                  }
                  theme={theme}
                  disabled={action.isPending}
                  onPress={() =>
                    action.mutate(async () => {
                      await dialog.run();
                      setDialog(null);
                    })
                  }
                />
                <Button
                  title={t("actions.cancel")}
                  theme={theme}
                  disabled={action.isPending}
                  onPress={close}
                />
              </View>
            </>
          )}
          {dialog.kind === "secret" && (
            <>
              <Text
                accessibilityRole="header"
                style={{ ...text, fontSize: 20 }}
              >
                {dialog.title}
              </Text>
              <Text style={muted}>
                {dialog.credential === "route-offer"
                  ? t("ui.offerHint")
                  : t("ui.secretHint")}
              </Text>
              {dialog.credential === "route-offer" && (
                <Text style={muted}>{t("ui.offerPreviewHint")}</Text>
              )}
              {dialog.hint && <Text style={muted}>{dialog.hint}</Text>}
              <TextInput
                accessibilityLabel={dialog.title}
                multiline
                editable={false}
                value={
                  dialog.credential === "route-offer"
                    ? routeOfferPreview(dialog.value)
                    : dialog.value
                }
                selectTextOnFocus
                style={{
                  ...text,
                  minHeight: 100,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.foregroundMuted,
                }}
              />
              {action.error && (
                <Text
                  accessibilityRole="alert"
                  style={{ color: theme.colors.statusDanger }}
                >
                  {friendlyError(action.error)}
                </Text>
              )}
              <View style={row}>
                <Button
                  variant="primary"
                  title={
                    dialog.copied ? t("actions.copied") : t("actions.copy")
                  }
                  theme={theme}
                  onPress={() =>
                    action.mutate(async () => {
                      await copyCredential(
                        dialog.value,
                        t(
                          dialog.credential === "route-offer"
                            ? "ui.offerCopyError"
                            : "ui.clipboard",
                        ),
                      );
                      setDialog({ ...dialog, copied: true });
                    })
                  }
                />
                <Button
                  title={t("actions.done")}
                  theme={theme}
                  onPress={close}
                />
              </View>
            </>
          )}
        </View>
      ) : (
        <>
          {action.error && (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger }}
            >
              {friendlyError(action.error)}
            </Text>
          )}
          {state.isPending && <Text style={muted}>{t("states.loading")}</Text>}
          {state.error && (
            <Text
              accessibilityRole="alert"
              style={{ color: theme.colors.statusDanger }}
            >
              {state.error.message}
            </Text>
          )}
          <View style={row}>
            <View style={{ flex: 1, justifyContent: "center" }}>
              <Text style={muted}>
                {host.label} · Relay{" "}
                {t(`status.${state.data?.relayStatus ?? "inactive"}`)}
              </Text>
            </View>
            <Button
              variant="ghost"
              title={state.isFetching ? t("states.loading") : t("ui.refresh")}
              theme={theme}
              disabled={state.isFetching}
              onPress={() => {
                void state.refetch();
              }}
            />
          </View>
          {state.data && (
            <>
              <View style={row}>
                <Text
                  accessibilityRole="header"
                  style={{
                    ...text,
                    fontSize: 16,
                    fontWeight: "500",
                    flex: 1,
                    alignSelf: "center",
                  }}
                >
                  Ingresses
                </Text>
                <Button
                  title={t("actions.addIngress")}
                  theme={theme}
                  disabled={action.isPending}
                  onPress={() => open({ kind: "create-ingress" })}
                />
              </View>
              {state.data.ingresses.length === 0 && (
                <Text style={muted}>{t("ui.ingressHint")}</Text>
              )}
              {state.data.ingresses.map((entry) => (
                <View key={entry.id} style={card}>
                  <Text style={{ ...text, fontSize: 15, fontWeight: "500" }}>
                    {entry.name} · {t(`status.${entry.status}`)}
                  </Text>
                  <Text selectable style={muted}>
                    {entry.targetOrigin}
                  </Text>
                  <View style={row}>
                    <Button
                      title={t("actions.copyOffer")}
                      theme={theme}
                      disabled={action.isPending}
                      onPress={() =>
                        action.mutate(async () => {
                          const { offer } = await exportOffer({ id: entry.id });
                          setDialog({
                            kind: "secret",
                            credential: "route-offer",
                            title: t("labels.routeOffer"),
                            value: offer,
                            copied: false,
                          });
                          await copyCredential(offer, t("ui.offerCopyError"));
                          setDialog({
                            kind: "secret",
                            credential: "route-offer",
                            title: t("labels.routeOffer"),
                            value: offer,
                            copied: true,
                          });
                        })
                      }
                    />
                    <Button
                      title={
                        expanded === entry.id
                          ? t("actions.done")
                          : t("ui.manage")
                      }
                      variant="ghost"
                      theme={theme}
                      onPress={() => {
                        expand(expanded === entry.id ? null : entry.id);
                        setTesting(null);
                      }}
                    />
                  </View>
                  {expanded === entry.id && (
                    <View style={row}>
                      <Button
                        title={t("actions.edit")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() => open({ kind: "edit-ingress", entry })}
                      />
                      <Button
                        title={entry.enabled ? t("ui.disable") : t("ui.enable")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() =>
                          action.mutate(async () => {
                            await updateIngress({
                              id: entry.id,
                              enabled: !entry.enabled,
                            });
                          })
                        }
                      />
                      <Button
                        title={t("actions.rotateSecret")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() =>
                          confirm(
                            t("actions.rotateSecret"),
                            t("confirm.rotateSecretMessage"),
                            async () => {
                              await rotateIngress({ id: entry.id });
                            },
                          )
                        }
                      />
                      <Button
                        title={t("actions.delete")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() =>
                          confirm(
                            t("delete.egressTitle", { name: entry.name }),
                            t("delete.ingressMessage"),
                            async () => {
                              await deleteIngress({ id: entry.id });
                            },
                          )
                        }
                      />
                    </View>
                  )}
                </View>
              ))}
              <View style={row}>
                <Text
                  accessibilityRole="header"
                  style={{
                    ...text,
                    fontSize: 16,
                    fontWeight: "500",
                    flex: 1,
                    alignSelf: "center",
                  }}
                >
                  Egresses
                </Text>
                <Button
                  title={t("actions.addEgress")}
                  theme={theme}
                  disabled={action.isPending}
                  onPress={() => open({ kind: "create-egress" })}
                />
              </View>
              {state.data.egresses.length === 0 && (
                <Text style={muted}>{t("ui.offerHint")}</Text>
              )}
              {state.data.egresses.map((entry) => (
                <View key={entry.id} style={card}>
                  <Text style={{ ...text, fontSize: 15, fontWeight: "500" }}>
                    {entry.name} · {t(`status.${entry.status}`)}
                  </Text>
                  <Text selectable style={muted}>
                    {entry.listen.host}:{entry.listen.port} →{" "}
                    {entry.ingressHostName} / {entry.ingressName}
                  </Text>
                  <Text style={muted}>
                    {t("labels.authentication")}:{" "}
                    {t(
                      entry.access.mode === "none"
                        ? "access.none"
                        : entry.access.mode === "header"
                          ? "access.headerShort"
                          : "access.bearerShort",
                    )}
                  </Text>
                  {entry.error && (
                    <Text style={{ color: theme.colors.statusDanger }}>
                      {entry.error}
                    </Text>
                  )}
                  {testing === entry.id && (
                    <RequestPanel
                      key={entry.id + entry.access.mode + entry.listen.port}
                      entry={entry}
                      theme={theme}
                      savedToken={tokens[entry.id]}
                    />
                  )}
                  <View style={row}>
                    <Button
                      title={t(
                        testing === entry.id ? "actions.done" : "ui.curl",
                      )}
                      theme={theme}
                      onPress={() => {
                        setTesting(testing === entry.id ? null : entry.id);
                        expand(null);
                      }}
                    />
                    <Button
                      title={
                        expanded === entry.id
                          ? t("actions.done")
                          : t("ui.manage")
                      }
                      theme={theme}
                      onPress={() => {
                        expand(expanded === entry.id ? null : entry.id);
                        setTesting(null);
                      }}
                    />
                  </View>
                  {expanded === entry.id && (
                    <View style={row}>
                      <Button
                        title={t("actions.edit")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() => open({ kind: "edit-egress", entry })}
                      />
                      <Button
                        title={entry.enabled ? t("ui.disable") : t("ui.enable")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() =>
                          action.mutate(async () => {
                            await updateEgress({
                              id: entry.id,
                              enabled: !entry.enabled,
                            });
                          })
                        }
                      />
                      <Button
                        title={t("actions.replaceOffer")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() => open({ kind: "replace-offer", entry })}
                      />
                      <Button
                        title={t("actions.rotateToken")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() => open({ kind: "rotate-token", entry })}
                      />
                      <Button
                        title={t("actions.delete")}
                        theme={theme}
                        disabled={action.isPending}
                        onPress={() =>
                          confirm(
                            t("delete.egressTitle", { name: entry.name }),
                            t("delete.egressMessage"),
                            async () => {
                              await deleteEgress({ id: entry.id });
                              setTokens((current) => {
                                const next = { ...current };
                                delete next[entry.id];
                                return next;
                              });
                            },
                          )
                        }
                      />
                    </View>
                  )}
                </View>
              ))}
            </>
          )}
        </>
      )}
      {!dialog && (
        <View style={{ alignItems: "center", paddingTop: 8 }}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="GitHub: lyhu/paseo-plugin-tunnel"
            disabled={action.isPending}
            onPress={() =>
              action.mutate(async () => {
                await Linking.openURL(
                  "https://github.com/lyhu/paseo-plugin-tunnel",
                );
              })
            }
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 12,
              justifyContent: "center",
              opacity: pressed ? 0.65 : 1,
            })}
          >
            <Text style={{ ...muted, fontSize: 12, textAlign: "center" }}>
              GitHub · paseo-plugin-tunnel ↗
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

async function copyCredential(
  value: string,
  errorMessage: string,
): Promise<void> {
  const result: unknown = await Clipboard.setString(value);
  if (result === false) throw new Error(errorMessage);
}

function friendlyError(error: Error | null): string | undefined {
  if (!error) return undefined;
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(" · ") || "Input"}: ${issue.message}`)
      .join("\n");
  }
  return error.message
    .replace(/^Request failed:\s*/, "")
    .replace(/\srequestType=plugin\.rpc\.invoke\.request(?:\scode=\S+)?$/, "");
}
