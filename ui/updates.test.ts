import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { showUpdateChecked } from "./updates";

/** Clicks the dialog button labeled `label` once it shows. */
async function press(label: string): Promise<HTMLElement> {
  await vi.waitFor(() => expect(document.querySelector(".sheet")).not.toBeNull());
  const scrim = document.querySelector<HTMLElement>(".sheet-scrim")!;
  [...scrim.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  return scrim;
}

describe("showUpdateChecked", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    document.body.replaceChildren();
  });

  it("shows that kayet is up to date in the middle of the window", async () => {
    const result = showUpdateChecked({ kind: "up-to-date", current: "0.14.0" });
    const scrim = await press("OK");
    expect(scrim.classList.contains("centered")).toBe(true);
    expect((await result).outcome).toBe("closed");
  });

  it("reports Update, and answers the backend", async () => {
    const result = showUpdateChecked({ kind: "available", version: "0.15.0", current: "0.14.0" });
    await press("Update");
    const { outcome, installing } = await result;
    expect(outcome).toBe("update");
    await installing;
    expect(invoke).toHaveBeenCalledWith("answer_update", { answer: "update" });
  });

  it("reports Later as closed", async () => {
    const result = showUpdateChecked({ kind: "available", version: "0.15.0", current: "0.14.0" });
    await press("Later");
    expect((await result).outcome).toBe("closed");
    expect(invoke).toHaveBeenCalledWith("answer_update", { answer: "later" });
  });
});
