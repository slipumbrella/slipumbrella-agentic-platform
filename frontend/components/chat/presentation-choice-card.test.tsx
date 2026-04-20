import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PresentationChoiceCard } from "./presentation-choice-card";

describe("PresentationChoiceCard", () => {
  it("renders the leader's question text", () => {
    render(
      <PresentationChoiceCard
        question="Would you like to see this as a workflow?"
        promptId="p1"
        originalMessage="Help me"
        sessionId="sess-1"
        onChoose={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Would you like to see this as a workflow?"),
    ).toBeDefined();
  });

  it("calls onChoose with 'workflow' when Show as Workflow is clicked", () => {
    const onChoose = vi.fn();
    render(
      <PresentationChoiceCard
        question="Show as workflow?"
        promptId="p1"
        originalMessage="Help me"
        sessionId="sess-1"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show as workflow/i }));
    expect(onChoose).toHaveBeenCalledWith("workflow");
  });

  it("calls onChoose with 'chat' when Keep in Chat is clicked", () => {
    const onChoose = vi.fn();
    render(
      <PresentationChoiceCard
        question="Show as workflow?"
        promptId="p1"
        originalMessage="Help me"
        sessionId="sess-1"
        onChoose={onChoose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep in chat/i }));
    expect(onChoose).toHaveBeenCalledWith("chat");
  });

  it("disables both buttons after a choice is made", () => {
    render(
      <PresentationChoiceCard
        question="Show as workflow?"
        promptId="p1"
        originalMessage="Help me"
        sessionId="sess-1"
        onChoose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show as workflow/i }));
    expect(
      screen.getByRole("button", { name: /show as workflow/i }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: /keep in chat/i }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
