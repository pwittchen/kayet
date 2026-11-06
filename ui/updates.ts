// App updates: the backend checks and installs (core/src/update.rs); these dialogs ask.

import { api } from "./api";
import { ask } from "./dialog";

/** What an update check found (`update://checked`). */
export type UpdateChecked =
  | { kind: "available"; version: string; current: string }
  | { kind: "up-to-date"; current: string }
  | { kind: "failed"; error: string };

/** An install that failed (`update://failed`). */
export interface UpdateFailed {
  error: string;
  version: string;
  page: string;
}

let offering = false;

/**
 * What became of a check's result: `update` when the user chose to install the new version,
 * `closed` when the dialog was dismissed otherwise, `none` when no dialog was shown (an offer
 * is open already).
 */
export type UpdateOutcome = "update" | "closed" | "none";

/**
 * Shows the result of a check, in the middle of the window; a newer version is offered with
 * Update, Skip This Version or Later. Resolves once the dialog is closed, before an update
 * chosen there is installed (`installing` follows the install).
 */
export async function showUpdateChecked(
  checked: UpdateChecked,
): Promise<{ outcome: UpdateOutcome; installing: Promise<void> }> {
  const done = Promise.resolve();
  switch (checked.kind) {
    case "up-to-date":
      await ask({
        title: "kayet is up to date",
        message: `kayet ${checked.current} is the latest version.`,
        buttons: [{ label: "OK", value: undefined, primary: true }],
        cancel: undefined,
        centered: true,
      });
      return { outcome: "closed", installing: done };
    case "failed":
      await ask({
        title: "Couldn't check for updates",
        message: checked.error,
        buttons: [{ label: "OK", value: undefined, primary: true }],
        cancel: undefined,
        centered: true,
      });
      return { outcome: "closed", installing: done };
    case "available": {
      // A later check while the offer is still open only refreshes the backend's release.
      if (offering) return { outcome: "none", installing: done };
      offering = true;
      const answer = await ask<"update" | "skip" | "later">({
        title: "A new version of kayet is available",
        message: `kayet ${checked.version} is available — you have ${checked.current}. kayet restarts to finish updating.`,
        buttons: [
          { label: "Skip This Version", value: "skip", leading: true },
          { label: "Later", value: "later" },
          { label: "Update", value: "update", primary: true },
        ],
        cancel: "later",
        centered: true,
      }).finally(() => (offering = false));
      return { outcome: answer === "update" ? "update" : "closed", installing: api.answerUpdate(answer) };
    }
  }
}

/** Offers the release page when installing failed. */
export async function showUpdateFailed(failed: UpdateFailed): Promise<void> {
  const download = await ask({
    title: "Couldn't install the update",
    message: `${failed.error}\n\nYou can download kayet ${failed.version} instead.`,
    buttons: [
      { label: "Cancel", value: false },
      { label: "Download", value: true, primary: true },
    ],
    cancel: false,
    centered: true,
  });
  if (download) await api.openExternal(failed.page);
}
