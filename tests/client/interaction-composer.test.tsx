// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { InteractionComposer } from "../../src/client/components/InteractionComposer";

it("keeps a draft and its error when collapsed or disconnected", () => {
  const handlers = {
    sessionId: "composer-test",
    interactionAvailable: true,
    interactionBusy: false,
    composerExpanded: true,
    previewExpanded: false,
    error: "send failed",
    onDismissError: vi.fn(),
    onSendMessage: vi.fn(),
    onSendKeys: vi.fn(),
    onHandoffPaneBinding: vi.fn(),
    onExpandPreview: vi.fn(),
    scrollToEnd: vi.fn(),
  };
  const view = render(<InteractionComposer {...handlers} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft" } });
  view.rerender(<InteractionComposer {...handlers} composerExpanded={false} />);
  expect(screen.getByRole("alert")).toHaveTextContent("send failed");
  view.rerender(<InteractionComposer {...handlers} interactionAvailable={false} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("send failed");
  view.rerender(<InteractionComposer {...handlers} />);
  expect(screen.getByRole("textbox")).toHaveValue("draft");
});
