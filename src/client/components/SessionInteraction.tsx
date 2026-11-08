import type { ReactNode } from "react";

import type { InteractionResponse } from "../../shared/api-contract";

import { useSessionInteraction } from "../state/use-session-interaction";
import { useTerminalPreview } from "../state/use-terminal-preview";
import { InteractionRegion } from "./InteractionRegion";

interface SessionInteractionProps {
  dockTarget?: HTMLElement | null;
  recoveryActions?: ReactNode;
  operationStatus?: ReactNode;
  managementBusy?: boolean;
  interaction: InteractionResponse | null;
  onNavigate?: (sessionId: string) => void;
  sessionId: string;
  onMessagePreview?: (message: string) => () => void;
  previewAutoExpandKey?: string | null;
}

export function SessionInteraction({
  dockTarget,
  recoveryActions,
  operationStatus,
  managementBusy,
  interaction,
  onNavigate,
  sessionId,
  onMessagePreview,
  previewAutoExpandKey = null,
}: SessionInteractionProps) {
  const interactionAvailable = interaction?.supported === true && interaction.state === "connected";
  const controller = useSessionInteraction(sessionId);

  const preview = useTerminalPreview(sessionId, interactionAvailable, previewAutoExpandKey);

  const sendMessage = async (message: string) => {
    const dismissPreview = /^\/[A-Za-z]+$/.test(message.trimEnd())
      ? undefined
      : onMessagePreview?.(message);
    try {
      await controller.sendMessage(message);
    } catch (reason) {
      dismissPreview?.();
      throw reason;
    }
  };

  return (
    <InteractionRegion
      key={sessionId}
      sessionId={sessionId}
      dockTarget={dockTarget}
      recoveryActions={recoveryActions}
      operationStatus={operationStatus}
      interaction={interaction}
      onNavigate={onNavigate}
      interactionBusy={controller.interactionBusy || !!managementBusy}
      error={controller.error}
      errorDetail={controller.errorDetail}
      onDismissError={controller.clearError}
      onSendMessage={sendMessage}
      onSendKeys={controller.sendKeys}
      onSendTerminalKeys={controller.sendTerminalKeys}
      onHandoffPaneBinding={controller.handoffPaneBinding}
      {...preview}
    />
  );
}
