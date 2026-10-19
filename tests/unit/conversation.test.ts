import { describe, expect, it } from "vitest";
import { parseFollowUp, stripWakePhrase, toSpoken } from "@/lib/shared/followups";
import { isLikelyQuestion, QuestionDetector } from "@/lib/shared/questionDetector";

describe("wake phrase and follow-ups", () => {
  it("strips the wake phrase", () => {
    expect(stripWakePhrase("Hey Jarvis, what time is it?")).toBe("what time is it?");
    expect(stripWakePhrase("jarvis. remind me")).toBe("remind me");
    expect(stripWakePhrase("OK Jarvis")).toBe("");
    expect(stripWakePhrase("What does Jarvis mean?")).toBe("What does Jarvis mean?");
  });

  it("recognizes follow-up commands", () => {
    expect(parseFollowUp("Explain that again")).toEqual({ kind: "rephrase" });
    expect(parseFollowUp("Hey Jarvis, can you explain that more simply?")).toEqual({ kind: "rephrase" });
    expect(parseFollowUp("Go deeper")).toEqual({ kind: "deeper" });
    expect(parseFollowUp("tell me more")).toEqual({ kind: "deeper" });
    expect(parseFollowUp("Give me an example")).toEqual({ kind: "example" });
    expect(parseFollowUp("Summarize the last five minutes")).toEqual({ kind: "summarize", minutes: 5 });
    expect(parseFollowUp("Jarvis, recap the last 15 minutes")).toEqual({ kind: "summarize", minutes: 15 });
    expect(parseFollowUp("summarize the meeting")).toEqual({ kind: "summarize", minutes: 10 });
  });

  it("does not treat ordinary questions as follow-ups", () => {
    expect(parseFollowUp("What is an example of a prime number greater than 100 that is also palindromic?")).toBeNull();
    expect(parseFollowUp("How deep is the Mariana Trench?")).toBeNull();
    expect(parseFollowUp("Explain quantum entanglement")).toBeNull();
  });

  it("makes speakable text without citations, links or markdown", () => {
    const s = toSpoken("**Canberra** is the capital [1, 2]. See https://example.com/x for more.\n\n- point one\n- point two", 5);
    expect(s).not.toMatch(/\[|\*|https?:/);
    expect(s).toContain("Canberra is the capital");
    expect(toSpoken("One. Two. Three. Four. Five.", 2)).toBe("One. Two. The full answer is on screen.");
  });
});

describe("ambient question detection", () => {
  it("recognizes questions asked nearby", () => {
    for (const q of ["Does anyone know what the capital of Australia is", "I wonder why the sky is blue", "Is it going to rain tomorrow?", "How far is the moon"]) {
      expect(isLikelyQuestion(q), q).toBe(true);
    }
  });

  it("ignores statements", () => {
    for (const s of ["I left the keys on the table.", "Okay.", "Let's go", "That was a great movie"]) {
      expect(isLikelyQuestion(s), s).toBe(false);
    }
  });

  it("waits for the speaker to pause before deciding", () => {
    const got: string[] = [];
    const d = new QuestionDetector({ onQuestion: (q) => got.push(q), quietMs: 900, questionQuietMs: 150 });
    d.push("So what was the name of", 0);
    expect(d.tick(500)).toBeNull();
    d.touch(800); // still talking
    d.push("that law about privacy", 1000);
    expect(d.tick(1500)).toBeNull();
    expect(d.tick(2000)).toBe("So what was the name of that law about privacy");
    expect(got).toHaveLength(1);
  });
});
