import { beforeEach, describe, expect, it } from "vitest";

import { ask, confirmUnsaved } from "./dialog";

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>(".sheet-button")];
const tick = () => new Promise((r) => setTimeout(r));

describe("ask", () => {
  beforeEach(() => document.body.replaceChildren());

  it("shows the title, message and buttons, focusing the primary one", async () => {
    const answer = confirmUnsaved("a.md");
    await tick();
    expect(document.querySelector(".sheet h2")?.textContent).toBe("Do you want to save the changes made to “a.md”?");
    expect(buttons().map((b) => b.textContent)).toEqual(["Don't Save", "Cancel", "Save"]);
    expect(document.activeElement).toBe(buttons()[2]);
    buttons()[0].click();
    expect(await answer).toBe("discard");
    expect(document.querySelector(".sheet-scrim")).toBeNull();
  });

  it("answers Esc with the cancel value and keeps the key from the page", async () => {
    let reached = false;
    const onKey = () => (reached = true);
    document.addEventListener("keydown", onKey);
    const answer = confirmUnsaved("a.md");
    await tick();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await answer).toBe("cancel");
    expect(reached).toBe(false);
    document.removeEventListener("keydown", onKey);
  });

  it("shows dialogs one at a time", async () => {
    const options = (title: string) => ({
      title,
      message: "",
      buttons: [{ label: "OK", value: title, primary: true }],
      cancel: "",
    });
    const first = ask(options("first"));
    const second = ask(options("second"));
    await tick();
    expect(document.querySelectorAll(".sheet")).toHaveLength(1);
    buttons()[0].click();
    expect(await first).toBe("first");
    await tick();
    expect(document.querySelector(".sheet h2")?.textContent).toBe("second");
    buttons()[0].click();
    expect(await second).toBe("second");
  });
});
