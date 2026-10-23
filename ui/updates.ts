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

/** Shows the result of a check; a newer version is offered with Update, Skip This Version or Later. */
export async function showUpdateChecked(checked: UpdateChecked): Promise<void> {
  switch (checked.kind) {
    case "up-to-date":
      await ask({
        title: "kayet is up to date",
        message: `kayet ${checked.current} is the latest version.`,
        buttons: [{ label: "OK", value: undefined, primary: true }],
        cancel: undefined,
      });
      return;
    case "failed":
      await ask({
        title: "Couldn't check for updates",
        message: checked.error,
        buttons: [{ label: "OK", value: undefined, primary: true }],
        cancel: undefined,
      });
      return;
    case "available": {
      // A later check while the offer is still open only refreshes the backend's release.
      if (offering) return;
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
      }).finally(() => (offering = false));
      await api.answerUpdate(answer);
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
  });
  if (download) await api.openExternal(failed.page);
}
