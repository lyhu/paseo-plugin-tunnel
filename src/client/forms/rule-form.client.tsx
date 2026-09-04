import { useTranslation } from "../language.client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useReducer } from "react";
import { Text, View } from "react-native";
import type {
  TunnelIngressState,
  TunnelEgressState,
  TunnelListenHost,
} from "../../shared/tunnel-types.shared";
import { RouteOfferSchema } from "../../shared/tunnel-types.shared";
import { Button, Choice, Field } from "../components/controls.client";

export type RuleForm =
  | { kind: "create-ingress" }
  | { kind: "edit-ingress"; entry: TunnelIngressState }
  | { kind: "create-egress" }
  | { kind: "edit-egress"; entry: TunnelEgressState }
  | { kind: "replace-offer"; entry: TunnelEgressState }
  | { kind: "rotate-token"; entry: TunnelEgressState };

export interface FormValues {
  name: string;
  targetOrigin: string;
  host: TunnelListenHost;
  port: string;
  offerString: string;
  mode: "header" | "bearer" | "none";
  token: string;
}

export function RuleFormView({
  form,
  theme,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  form: RuleForm;
  theme: PluginTheme;
  pending: boolean;
  error?: string;
  onSubmit: (value: FormValues) => void;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const entry = "entry" in form ? form.entry : undefined;
  const [values, update] = useReducer(
    (state: FormValues, patch: Partial<FormValues>) => ({ ...state, ...patch }),
    {
      name: entry?.name ?? "",
      targetOrigin:
        entry && "targetOrigin" in entry
          ? entry.targetOrigin
          : "http://127.0.0.1:3000",
      host:
        entry && "listen" in entry && entry.listen.host === "0.0.0.0"
          ? "0.0.0.0"
          : "127.0.0.1",
      port: entry && "listen" in entry ? String(entry.listen.port) : "8080",
      offerString: "",
      mode: entry && "access" in entry ? entry.access.mode : "header",
      token: "",
    },
  );
  const titles: Record<RuleForm["kind"], string> = {
    "create-ingress": t("actions.addIngress"),
    "edit-ingress": t("actions.edit"),
    "create-egress": t("actions.addEgress"),
    "edit-egress": t("actions.edit"),
    "replace-offer": t("actions.replaceOffer"),
    "rotate-token": t("actions.rotateToken"),
  };
  const showName = [
    "create-ingress",
    "edit-ingress",
    "create-egress",
    "edit-egress",
  ].includes(form.kind);
  const showOrigin =
    form.kind === "create-ingress" || form.kind === "edit-ingress";
  const showListen =
    form.kind === "create-egress" || form.kind === "edit-egress";
  const showOffer =
    form.kind === "create-egress" || form.kind === "replace-offer";
  const showAccess =
    form.kind === "create-egress" || form.kind === "rotate-token";
  const offer = readOffer(values.offerString);
  const descriptions: Record<RuleForm["kind"], string> = {
    "create-ingress": t("ui.ingressHint"),
    "edit-ingress": t("ui.editIngressHint"),
    "create-egress": t("ui.offerHint"),
    "edit-egress": t("ui.editEgressHint"),
    "replace-offer": t("ui.offerHint"),
    "rotate-token": t("ui.rotateHint"),
  };
  return (
    <View style={{ gap: 20 }}>
      <Text
        accessibilityRole="header"
        style={{ color: theme.colors.foreground, fontSize: 20 }}
      >
        {titles[form.kind]}
      </Text>
      <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 21 }}>
        {descriptions[form.kind]}
      </Text>
      {showName && (
        <Field
          label={t("form.name")}
          value={values.name}
          onChange={(name) => update({ name })}
          theme={theme}
        />
      )}
      {showOrigin && (
        <Field
          label={t("form.originHint")}
          value={values.targetOrigin}
          onChange={(targetOrigin) => update({ targetOrigin })}
          theme={theme}
        />
      )}
      {showOffer && (
        <>
          <Field
            label={t("labels.routeOffer")}
            value={values.offerString}
            onChange={(offerString) => update({ offerString })}
            theme={theme}
            multiline
          />
          {values.offerString.trim() &&
            (offer ? (
              <View
                style={{
                  gap: 6,
                  padding: 12,
                  borderLeftWidth: 2,
                  borderColor: theme.colors.accent,
                }}
              >
                <Text
                  style={{ color: theme.colors.foreground, fontWeight: "500" }}
                >
                  {offer.ingressName}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  {t("labels.sourceHost")} · {offer.ingressHostName}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted }}>
                  Relay · {offer.relayEndpoint}
                </Text>
                {showListen && (
                  <Button
                    title={`${t("labels.listenerPort")}: ${offer.suggestedPort}`}
                    variant="ghost"
                    theme={theme}
                    onPress={() =>
                      update({ port: String(offer.suggestedPort) })
                    }
                  />
                )}
              </View>
            ) : (
              <Text
                accessibilityRole="alert"
                style={{ color: theme.colors.statusDanger }}
              >
                {t("errors.invalidRouteOffer")}
              </Text>
            ))}
        </>
      )}
      {showListen && (
        <>
          <Choice
            label={t("labels.listenScope")}
            labels={{
              "127.0.0.1": t("form.localOnly"),
              "0.0.0.0": t("form.allInterfaces"),
            }}
            value={values.host}
            options={["127.0.0.1", "0.0.0.0"]}
            onChange={(host) => update({ host })}
            theme={theme}
          />
          <Field
            label={t("labels.listenerPort")}
            numeric
            value={values.port}
            onChange={(port) => update({ port })}
            theme={theme}
          />
          {values.host === "0.0.0.0" && (
            <Text style={{ color: theme.colors.foregroundMuted }}>
              {t("form.networkWarning")}
            </Text>
          )}
        </>
      )}
      {showAccess && (
        <>
          <Choice
            label={t("labels.authentication")}
            labels={{
              header: t("labels.accessToken"),
              bearer: t("access.bearerShort"),
              none: t("access.none"),
            }}
            value={values.mode}
            options={["header", "bearer", "none"]}
            onChange={(mode) => update({ mode })}
            theme={theme}
          />
          <Text style={{ color: theme.colors.foregroundMuted }}>
            {values.mode === "header"
              ? "X-Paseo-Access-Token: <token>"
              : values.mode === "bearer"
                ? "Authorization: Bearer <token>"
                : t("confirm.noAccessMessage")}
          </Text>
          {values.mode !== "none" && (
            <Field
              label={t("ui.customToken")}
              value={values.token}
              onChange={(token) => update({ token })}
              theme={theme}
              secret
            />
          )}
        </>
      )}
      {error && (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.colors.statusDanger }}
        >
          {error}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button
          variant="primary"
          title={
            pending
              ? t("actions.saving")
              : form.kind === "create-ingress"
                ? t("actions.addIngress")
                : form.kind === "create-egress"
                  ? t("actions.addEgress")
                  : t("actions.save")
          }
          onPress={() => onSubmit(values)}
          disabled={pending || (showOffer && !offer)}
          theme={theme}
        />
        <Button
          title={t("actions.cancel")}
          onPress={onCancel}
          disabled={pending}
          theme={theme}
        />
      </View>
    </View>
  );
}

function readOffer(value: string) {
  try {
    const parsed = RouteOfferSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
