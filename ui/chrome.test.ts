import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { setChromeVisible: vi.fn(() => Promise.resolve()) } }));

import { api } from "./api";
import { Chrome } from "./chrome";

const HIDE_DELAY_MS = 800;

let titlebar: HTMLElement;
let edgeHandle: HTMLElement;
let treeVisible: boolean;
let onPinnedChange: ReturnType<typeof vi.fn<(pinned: boolean) => void>>;
let chrome: Chrome;
// Chrome registers listeners on document; remove them after each test so instances don't leak.
let listeners: [EventTarget, string, EventListenerOrEventListenerObject][];

function move(clientX: number, clientY: number, target: EventTarget = document.body): void {
  target.dispatchEvent(new MouseEvent("mousemove", { clientX, clientY, bubbles: true }));
}

const titlebarShown = () => titlebar.classList.contains("visible");
const handleShown = () => edgeHandle.classList.contains("visible");

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.setChromeVisible).mockClear();
  listeners = [];
  for (const target of [document, document.documentElement]) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
      if (listener) listeners.push([target, type, listener]);
      add(type, listener, options);
    });
  }

  titlebar = document.createElement("div");
  edgeHandle = document.createElement("div");
  document.body.replaceChildren(titlebar, edgeHandle);
  treeVisible = false;
  onPinnedChange = vi.fn<(pinned: boolean) => void>();
  chrome = new Chrome(titlebar, edgeHandle, () => treeVisible, onPinnedChange);
});

afterEach(() => {
  for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("title bar hover-reveal", () => {
  it("is hidden initially", () => {
    expect(titlebarShown()).toBe(false);
    expect(api.setChromeVisible).not.toHaveBeenCalled();
  });

  it("shows immediately when the pointer enters the top zone", () => {
    move(300, 40);
    expect(titlebarShown()).toBe(true);
    expect(api.setChromeVisible).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("does not show below the top zone", () => {
    move(300, 41);
    expect(titlebarShown()).toBe(false);
  });

  it("does not re-notify the backend while already visible", () => {
    move(300, 10);
    move(300, 20);
    move(300, 30);
    expect(api.setChromeVisible).toHaveBeenCalledTimes(1);
  });

  it("fades out only after the hide delay once the pointer leaves", () => {
    move(300, 10);
    move(300, 200);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(titlebarShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(titlebarShown()).toBe(false);
    expect(api.setChromeVisible).toHaveBeenLastCalledWith(false);
  });

  it("does not restart the hide delay on further moves outside the zone", () => {
    move(300, 10);
    move(300, 200);
    vi.advanceTimersByTime(500);
    move(300, 300);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 500);
    expect(titlebarShown()).toBe(false);
  });

  it("cancels a pending hide when the pointer returns", () => {
    move(300, 10);
    move(300, 200);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 100);
    move(300, 10);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    expect(titlebarShown()).toBe(true);
    expect(api.setChromeVisible).toHaveBeenCalledTimes(1);
  });

  it("stays visible while hovering the revealed title bar below the zone", () => {
    const button = document.createElement("button");
    titlebar.append(button);
    move(300, 10);
    move(300, 60, button);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    expect(titlebarShown()).toBe(true);
  });

  it("is not revealed by hovering the hidden title bar below the zone", () => {
    move(300, 60, titlebar);
    expect(titlebarShown()).toBe(false);
  });

  it("schedules a hide when the pointer leaves the window", () => {
    move(300, 10);
    document.documentElement.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(titlebarShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(titlebarShown()).toBe(false);
  });

  it("hides immediately when typing", () => {
    move(300, 10);
    chrome.onTyping();
    expect(titlebarShown()).toBe(false);
    expect(api.setChromeVisible).toHaveBeenLastCalledWith(false);
  });
});

describe("pinning", () => {
  it("shows the title bar and keeps it visible", () => {
    chrome.setPinned(true);
    expect(titlebarShown()).toBe(true);
    expect(onPinnedChange).toHaveBeenLastCalledWith(true);

    move(300, 200);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    chrome.onTyping();
    expect(titlebarShown()).toBe(true);
  });

  it("hides immediately when unpinned", () => {
    chrome.setPinned(true);
    chrome.togglePinned();
    expect(titlebarShown()).toBe(false);
    expect(onPinnedChange).toHaveBeenLastCalledWith(false);
  });
});

describe("hold", () => {
  it("keeps the title bar visible until the held work settles, then fades", async () => {
    let finish!: () => void;
    move(300, 10);
    const held = chrome.hold(new Promise<void>((resolve) => (finish = resolve)));

    move(300, 200);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    chrome.hide();
    expect(titlebarShown()).toBe(true);

    finish();
    await held;
    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(titlebarShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(titlebarShown()).toBe(false);
  });

  it("releases the hold when the work fails", async () => {
    move(300, 10);
    await expect(chrome.hold(Promise.reject(new Error("cancelled")))).rejects.toThrow("cancelled");
    vi.advanceTimersByTime(HIDE_DELAY_MS);
    expect(titlebarShown()).toBe(false);
  });
});

describe("left-edge handle", () => {
  it("shows when the pointer reaches the left edge", () => {
    move(12, 300);
    expect(handleShown()).toBe(true);
  });

  it("does not show away from the edge", () => {
    move(13, 300);
    expect(handleShown()).toBe(false);
  });

  it("does not show while the file tree is visible", () => {
    treeVisible = true;
    move(0, 300);
    expect(handleShown()).toBe(false);
  });

  it("stays visible while hovered, even away from the edge", () => {
    move(0, 300);
    move(20, 300, edgeHandle);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    expect(handleShown()).toBe(true);
  });

  it("fades out after the hide delay", () => {
    move(0, 300);
    move(200, 300);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 1);
    expect(handleShown()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(handleShown()).toBe(false);
  });

  it("cancels a pending fade when the pointer returns", () => {
    move(0, 300);
    move(200, 300);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 100);
    move(0, 300);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 2);
    expect(handleShown()).toBe(true);
  });

  it("fades out after the pointer leaves the window", () => {
    move(0, 300);
    document.documentElement.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(HIDE_DELAY_MS);
    expect(handleShown()).toBe(false);
  });

  it("hides immediately when typing", () => {
    move(0, 300);
    chrome.onTyping();
    expect(handleShown()).toBe(false);
  });

  it("is independent of the title bar in the top-left corner", () => {
    move(0, 0);
    expect(titlebarShown()).toBe(true);
    expect(handleShown()).toBe(true);
  });
});
