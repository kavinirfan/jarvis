import { Fragment, type ReactNode } from "react";
import type { PublicSourceDto } from "@/lib/shared/events";

/**
 * Minimal, XSS-safe Markdown: builds React elements (never raw HTML). Supports paragraphs,
 * headings, bullet/numbered lists, code blocks, **bold**, *italic*, `code`, http(s) links,
 * and [n] citations linked to their sources.
 */
export function Markdown({ text, sources = [] }: { text: string; sources?: PublicSourceDto[] }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={blocks.length} className="my-3 overflow-x-auto rounded-lg border border-line bg-black/40 p-3 font-mono text-[0.8rem] leading-relaxed text-accent-2/90">
          {code.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push(
        <p key={blocks.length} className="mt-4 mb-1 font-semibold tracking-tight text-fg first:mt-0">
          {inline(h[2], sources)}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
      const Tag = ordered ? "ol" : "ul";
      blocks.push(
        <Tag key={blocks.length} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-accent/70`}>
          {items.map((it, k) => (
            <li key={k}>{inline(it, sources)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={blocks.length} className="my-2 first:mt-0 last:mb-0">
        {inline(para.join(" "), sources)}
      </p>,
    );
  }
  return <div className="leading-relaxed">{blocks}</div>;
}

const TOKEN = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[(?:\d+(?:,\s*\d+)*)\]|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;

function inline(text: string, sources: PublicSourceDto[]): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={k++} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k++} className="rounded bg-white/5 px-1 font-mono text-[0.85em] text-accent-2">{t.slice(1, -1)}</code>);
    else if (/^\[\d/.test(t)) {
      const nums = t.slice(1, -1).split(",").map((x) => Number(x.trim()));
      out.push(
        <sup key={k++} className="ml-0.5 whitespace-nowrap">
          {nums.map((n, j) => {
            const s = sources.find((x) => x.n === n);
            return (
              <Fragment key={n}>
                {j > 0 && <span className="text-faint">,</span>}
                {s ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" title={`${s.title} — ${s.domain}`} className="rounded px-0.5 font-mono text-[0.7rem] text-accent hover:bg-accent-soft hover:underline">
                    {n}
                  </a>
                ) : (
                  <span className="font-mono text-[0.7rem] text-faint">{n}</span>
                )}
              </Fragment>
            );
          })}
        </sup>,
      );
    } else if (t.startsWith("[")) {
      const lm = t.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)!;
      out.push(<a key={k++} href={lm[2]} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline-offset-2 hover:underline">{lm[1]}</a>);
    } else if (t.startsWith("http")) {
      out.push(<a key={k++} href={t} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-accent underline-offset-2 hover:underline">{t}</a>);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
