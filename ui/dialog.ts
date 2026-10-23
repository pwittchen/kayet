// In-app dialogs: a sheet that drops in below the title bar, over the dimmed window, in
// place of native alerts. Saving prompts, crash recovery, Trash and app updates use it.

export interface DialogButton<T> {
  label: string;
  value: T;
  /** The default action: filled with the accent color, focused and chosen with Enter. */
  primary?: boolean;
  /** Set apart on the left, like Don't Save in a macOS alert. */
  leading?: boolean;
}

export interface DialogOptions<T> {
  title: string;
  message: string;
  /** In display order, left to right. */
  buttons: DialogButton<T>[];
  /** What Esc answers. */
  cancel: T;
}

let queue: Promise<unknown> = Promise.resolve();

/** Shows a dialog and resolves with the chosen button's value; dialogs asked meanwhile wait their turn. */
export function ask<T>(options: DialogOptions<T>): Promise<T> {
  const answer = queue.then(() => show(options));
  queue = answer.catch(() => {});
  return answer;
}

function show<T>({ title, message, buttons, cancel }: DialogOptions<T>): Promise<T> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const scrim = document.createElement("div");
    scrim.className = "sheet-scrim";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.setAttribute("role", "alertdialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "sheet-title");
    sheet.setAttribute("aria-describedby", "sheet-message");
    sheet.tabIndex = -1;
    const heading = document.createElement("h2");
    heading.id = "sheet-title";
    heading.textContent = title;
    const text = document.createElement("p");
    text.id = "sheet-message";
    text.textContent = message;
    const row = document.createElement("div");
    row.className = "sheet-buttons";
    const elements = buttons.map((b) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sheet-button";
      button.classList.toggle("primary", !!b.primary);
      button.classList.toggle("leading", !!b.leading);
      button.textContent = b.label;
      button.addEventListener("click", () => done(b.value));
      return button;
    });
    row.append(...elements);
    sheet.append(heading, text, row);
    scrim.append(sheet);
    document.body.append(scrim);

    // While open, keys belong to the dialog: Esc cancels, Tab cycles its buttons and app
    // shortcuts handled in the page don't act underneath (Enter / Space press the focused button).
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        done(cancel);
      } else if (e.key === "Tab") {
        e.preventDefault();
        const i = elements.indexOf(document.activeElement as HTMLButtonElement);
        const next = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + elements.length) % elements.length;
        elements[next]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    (elements[buttons.findIndex((b) => b.primary)] ?? elements.at(-1) ?? sheet).focus();

    function done(value: T): void {
      window.removeEventListener("keydown", onKey, true);
      scrim.remove();
      previous?.focus?.();
      resolve(value);
    }
  });
}

/** Asks to save the changes to `name` before they're lost. */
export function confirmUnsaved(name: string): Promise<"save" | "discard" | "cancel"> {
  return ask({
    title: `Do you want to save the changes made to “${name}”?`,
    message: "Your changes will be lost if you don't save them.",
    buttons: [
      { label: "Don't Save", value: "discard", leading: true },
      { label: "Cancel", value: "cancel" },
      { label: "Save", value: "save", primary: true },
    ],
    cancel: "cancel",
  });
}

/** Asks to write the changes to `name` to disk. */
export function confirmSave(name: string): Promise<boolean> {
  return ask({
    title: `Do you want to save the changes made to “${name}”?`,
    message: "Your changes will be written to disk.",
    buttons: [
      { label: "Cancel", value: false },
      { label: "Save", value: true, primary: true },
    ],
    cancel: false,
  });
}

/** Asks whether to restore the unsaved changes to `name` and `others` more documents. */
export function confirmRestore(name: string, others: number): Promise<boolean> {
  const documents =
    others === 0 ? `“${name}”` : `“${name}” and ${others} other document${others === 1 ? "" : "s"}`;
  return ask({
    title: `Restore unsaved changes to ${documents}?`,
    message: "kayet didn't quit normally. If you don't restore them, the changes will be lost.",
    buttons: [
      { label: "Discard", value: false },
      { label: "Restore", value: true, primary: true },
    ],
    cancel: false,
  });
}

/** Asks to move `name` to the Trash. */
export function confirmTrash(name: string): Promise<boolean> {
  return ask({
    title: `Move “${name}” to the Trash?`,
    message: "You can restore it from the Trash later.",
    buttons: [
      { label: "Cancel", value: false },
      { label: "Move to Trash", value: true, primary: true },
    ],
    cancel: false,
  });
}
