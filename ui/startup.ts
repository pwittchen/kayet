// Revealing the window at launch: it is on screen but transparent until the first screen is painted.

import { afterPaint } from "./bench";

/**
 * Waits for `init` to settle (also when it fails), then for a painted frame, then calls `show`,
 * so the window never shows the UI half-drawn. Resolves or rejects like `init`.
 */
export async function showWhenPainted(
  init: Promise<void>,
  show: () => Promise<void>,
  paint: () => Promise<unknown> = afterPaint,
): Promise<void> {
  try {
    await init;
  } finally {
    await paint();
    await show();
  }
}
