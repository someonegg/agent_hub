import { useTranslation } from "react-i18next";

import { ApiClientError } from "../api/client";
import { locale, type PlainMessageKey, t } from "../i18n";
import { LocalizedError } from "../i18n/localized-error";

const errorKeys = {
  not_found: "requestNotFound",
  session_not_found: "requestNotFound",
  message_not_submitted: "messageNotSubmitted",
  interaction_not_supported: "interactionNotSupported",
  interaction_failed: "interactionFailed",
  operation_result_unknown: "operationResultUnknown",
  session_busy: "sessionIsBusyTryAgainLater",
  interaction_not_connected: "requestDisconnected",
  payload_too_large: "requestTooLarge",
  upload_too_large: "requestTooLarge",
} as const;

/** Translate known application errors; retain diagnostics for unexpected failures. */
export function RequestError({ error, summary }: { error: unknown; summary?: PlainMessageKey }) {
  useTranslation();
  if (error instanceof LocalizedError) return <>{t(error.key)}</>;
  if (error instanceof ApiClientError && Object.hasOwn(errorKeys, error.code))
    return <>{t(errorKeys[error.code as keyof typeof errorKeys])}</>;
  const detail = error instanceof Error ? error.message : String(error);
  if (locale() === "en-US") return <>{detail}</>;
  return (
    <>
      {t(summary ?? "requestFailed")}{" "}
      <span className="request-error-detail">
        {t("requestDetails")}:<code>{detail}</code>
      </span>
    </>
  );
}
