import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useToastStore } from "../shared/store/toastStore";
import { ToastProvider, toastSeverityType } from "../shared/ui/Toast";

describe("Toast severity semantics", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("announces errors assertively and non-errors politely", () => {
    useToastStore.setState({
      toasts: [
        { id: "error", type: "error", title: "Failed" },
        { id: "info", type: "info", title: "Ready" },
      ],
    });

    const { getByRole, getByText } = render(
      <ToastProvider>
        <div>App</div>
      </ToastProvider>,
    );

    expect(getByRole("alert").getAttribute("aria-live")).toBe("assertive");
    expect(getByText("Ready").closest("li")?.getAttribute("aria-live")).toBe("polite");
    expect(toastSeverityType("error")).toBe("foreground");
    expect(toastSeverityType("warning")).toBe("background");
  });
});
