import { describe, expect, it } from "vitest";

import { showWhenPainted } from "./startup";

/** A promise resolved (or rejected) by hand, to control the order things finish in. */
function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void } {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("showWhenPainted", () => {
  it("shows the window only after init and a painted frame", async () => {
    const events: string[] = [];
    const init = deferred();
    const frame = deferred();
    const done = showWhenPainted(
      init.promise,
      async () => void events.push("show"),
      () => (events.push("paint requested"), frame.promise),
    );

    await flush();
    expect(events).toEqual([]);

    init.resolve();
    await flush();
    expect(events).toEqual(["paint requested"]);

    frame.resolve();
    await done;
    expect(events).toEqual(["paint requested", "show"]);
  });

  it("still shows the window when init fails, and passes the failure on", async () => {
    let shown = false;
    const done = showWhenPainted(
      Promise.reject(new Error("boom")),
      async () => void (shown = true),
      () => Promise.resolve(),
    );

    await expect(done).rejects.toThrow("boom");
    expect(shown).toBe(true);
  });

  it("waits for a real animation frame by default", async () => {
    let shown = false;
    await showWhenPainted(Promise.resolve(), async () => void (shown = true));
    expect(shown).toBe(true);
  });
});
