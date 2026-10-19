import { describe, expect, it } from "vitest";
import { parseMemoryCommand } from "@/lib/server/memory";

describe("explicit memory commands", () => {
  it("parses remember commands and classifies them", () => {
    expect(parseMemoryCommand("Hey Jarvis, remember that I prefer short answers")).toEqual({ action: "remember", content: "I prefer short answers", kind: "preference" });
    expect(parseMemoryCommand("remember I'm working on a robotics project")).toEqual({ action: "remember", content: "I'm working on a robotics project", kind: "project" });
    expect(parseMemoryCommand("Note that my sister lives in Chennai.")).toEqual({ action: "remember", content: "My sister lives in Chennai", kind: "fact" });
  });
  it("parses forget commands", () => {
    expect(parseMemoryCommand("forget about my sister")).toEqual({ action: "forget", content: "my sister" });
  });
  it("ignores normal questions", () => {
    expect(parseMemoryCommand("Do you remember the capital of Peru?")).toBeNull();
    expect(parseMemoryCommand("What did I tell you to remember?")).toBeNull();
  });
});
