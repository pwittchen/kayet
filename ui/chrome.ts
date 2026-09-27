// Hover-reveal logic for the title bar (and native traffic lights) and the left-edge handle.

import { api } from "./api";

const TOP_ZONE_PX = 40;
const EDGE_ZONE_PX = 12;
const HIDE_DELAY_MS = 800;

export class Chrome {
  private visible = false;
  private pinned = false;
  private holds = 0;
  private hideTimer: number | undefined;
  private edgeTimer: number | undefined;

  constructor(
    private readonly titlebar: HTMLElement,
    private readonly edgeHandle: HTMLElement,
    private readonly treeVisible: () => boolean,
    private readonly onPinnedChange: (pinned: boolean) => void,
    private readonly onShow: () => void = () => {},
  ) {
    document.addEventListener("mousemove", (e) => this.onMouseMove(e), { passive: true });
    document.documentElement.addEventListener("mouseleave", () => {
      this.scheduleHide();
      this.scheduleEdgeHide();
    });
  }

  private onMouseMove(e: MouseEvent): void {
    const overTitlebar = this.visible && this.titlebar.contains(e.target as Node);
    if (e.clientY <= TOP_ZONE_PX || overTitlebar) this.show();
    else this.scheduleHide();

    const overHandle = this.edgeHandle.contains(e.target as Node);
    if ((e.clientX <= EDGE_ZONE_PX || overHandle) && !this.treeVisible()) {
      window.clearTimeout(this.edgeTimer);
      this.edgeTimer = undefined;
      this.edgeHandle.classList.add("visible");
    } else {
      this.scheduleEdgeHide();
    }
  }

  show(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (this.visible) return;
    this.visible = true;
    this.titlebar.classList.add("visible");
    document.body.classList.add("chrome-visible");
    void api.setChromeVisible(true);
    this.onShow();
  }

  hide(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    if (!this.visible || this.pinned || this.holds > 0) return;
    this.visible = false;
    this.titlebar.classList.remove("visible");
    document.body.classList.remove("chrome-visible");
    void api.setChromeVisible(false);
  }

  private scheduleHide(): void {
    if (!this.visible || this.pinned || this.holds > 0 || this.hideTimer !== undefined) return;
    this.hideTimer = window.setTimeout(() => this.hide(), HIDE_DELAY_MS);
  }

  private scheduleEdgeHide(): void {
    if (this.edgeTimer !== undefined || !this.edgeHandle.classList.contains("visible")) return;
    this.edgeTimer = window.setTimeout(() => {
      this.edgeTimer = undefined;
      this.edgeHandle.classList.remove("visible");
    }, HIDE_DELAY_MS);
  }

  /** Focus mode: typing hides revealed chrome immediately (unless pinned). */
  onTyping(): void {
    this.hide();
    this.edgeHandle.classList.remove("visible");
  }

  /** Pinned chrome stays visible all the time (title bar pin button / `⌘.`). */
  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    if (pinned) this.show();
    else this.hide();
    this.onPinnedChange(pinned);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  togglePinned(): void {
    this.setPinned(!this.pinned);
  }

  /** Keeps chrome visible while a dialog or menu started from it is open. */
  async hold<T>(work: Promise<T>): Promise<T> {
    this.holds++;
    try {
      return await work;
    } finally {
      this.holds--;
      this.scheduleHide();
    }
  }
}
