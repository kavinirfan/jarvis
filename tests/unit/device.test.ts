import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { isSensitivePath, resolveUserPath } from "@/lib/server/device/macos";
import { cosine, hashEmbedding } from "@/lib/server/learning";
import { TOOLS } from "@/lib/server/tools/registry";

const HOME = homedir();

describe("device file access stays inside the home folder", () => {
  it("resolves ~ and relative paths into home", () => {
    expect(resolveUserPath("~/Desktop/a.txt")).toBe(`${HOME}/Desktop/a.txt`);
    expect(resolveUserPath("Documents")).toBe(`${HOME}/Documents`);
  });
  it("rejects paths outside home, including ../ escapes", () => {
    expect(() => resolveUserPath("/etc/passwd")).toThrow();
    expect(() => resolveUserPath("~/../../etc/hosts")).toThrow();
    expect(() => resolveUserPath("/Users")).toThrow();
  });
  it("flags sensitive locations so reading them needs approval", () => {
    for (const p of ["~/.ssh/id_ed25519", "~/project/.env", "~/.env.local", "~/Library/Keychains/login.keychain-db", "~/certs/server.pem", "~/Library/Application Support/Google/Chrome/Default/Cookies"]) {
      expect(isSensitivePath(resolveUserPath(p)), p).toBe(true);
    }
    expect(isSensitivePath(resolveUserPath("~/Documents/essay.md"))).toBe(false);
  });
});

describe("tool catalogue", () => {
  it("has no general-purpose shell or script execution tool", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.some((n) => /shell|exec|script|terminal|command/.test(n))).toBe(false);
  });
  it("requires approval for destructive or outbound device actions", () => {
    for (const n of ["write_file", "move_to_trash", "send_imessage", "quit_app", "delete_notes"]) {
      expect(TOOLS.find((t) => t.name === n)?.confirm, n).toBe(true);
    }
  });
});

describe("semantic recall fallback", () => {
  it("keyword vectors rank related text higher", () => {
    const q = hashEmbedding("what units do I like");
    expect(cosine(q, hashEmbedding("Prefers metric units"))).toBeGreaterThan(cosine(q, hashEmbedding("Lives in Chennai")));
  });
});
