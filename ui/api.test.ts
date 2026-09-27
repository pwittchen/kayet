import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { api } from "./api";

const mocked = vi.mocked(invoke);

beforeEach(() => mocked.mockReset());

describe("file text as raw bytes", () => {
  it("decodes a read file as UTF-8, keeping a byte order mark", async () => {
    const text = "\uFEFFzażółć 👋\n";
    mocked.mockResolvedValue(new TextEncoder().encode(text).buffer);
    expect(await api.readFile("/w/a.md")).toBe(text);
    expect(mocked).toHaveBeenCalledWith("read_file", { path: "/w/a.md" });
  });

  it("writes the text as the body and the path in a header", async () => {
    await api.writeFile("/w/ä b.md", "héllo");
    const [cmd, body, options] = mocked.mock.calls[0];
    expect(cmd).toBe("write_file");
    expect(new TextDecoder().decode(body as Uint8Array)).toBe("héllo");
    expect(options).toEqual({ headers: { "kayet-path": encodeURIComponent("/w/ä b.md") } });
  });

  it("sends backups one after another, with their byte lengths", async () => {
    await api.writeRecovery([
      { path: "/w/a.md", text: "żółw" },
      { path: null, text: "" },
      { path: "/w/b.md", text: "👋 hi" },
    ]);
    const [cmd, body, options] = mocked.mock.calls[0];
    expect(cmd).toBe("write_recovery");
    expect(new TextDecoder().decode(body as Uint8Array)).toBe("żółw👋 hi");
    const header = (options as { headers: Record<string, string> }).headers["kayet-backups"];
    expect(JSON.parse(decodeURIComponent(header))).toEqual([
      { path: "/w/a.md", bytes: 7 },
      { path: null, bytes: 0 },
      { path: "/w/b.md", bytes: 7 },
    ]);
  });
});
