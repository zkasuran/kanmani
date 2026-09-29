"use client";

/**
 * "Build an agent" on /developers: pick how you build, get the exact snippet.
 *
 * Data from lib/recipes.ts, each with the doc it was checked against. Tabs are real buttons in a
 * tablist with arrow-key movement, so the whole matrix is reachable without a mouse.
 */
import { useRef, useState } from "react";
import { RECIPES } from "@/lib/recipes.ts";

export function BuildRecipes() {
  const [group, setGroup] = useState(RECIPES[0]!.id);
  const [copied, setCopied] = useState<string | null>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const g = RECIPES.find((x) => x.id === group) ?? RECIPES[0]!;

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch {
      /* the text stays selectable */
    }
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const j = (n + RECIPES.length) % RECIPES.length;
    setGroup(RECIPES[j]!.id);
    tabs.current[j]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="how you build" className="recipe-tabs flex flex-wrap gap-1.5">
        {RECIPES.map((r, i) => (
          <button
            key={r.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            role="tab"
            id={`tab-${r.id}`}
            aria-selected={r.id === group}
            aria-controls={`panel-${r.id}`}
            tabIndex={r.id === group ? 0 : -1}
            onClick={() => setGroup(r.id)}
            onKeyDown={(e) => onKey(e, i)}
            className="recipe-tab font-mono text-[12px]"
          >
            {r.title}
            <span className="ml-1.5 text-faint">{r.recipes.length}</span>
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${g.id}`} aria-labelledby={`tab-${g.id}`} className="mt-3">
        <p className="max-w-3xl text-[13px] leading-relaxed text-muted">{g.lead}</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {g.recipes.map((r) => {
            const key = `${g.id}:${r.name}`;
            return (
              <div key={key} className="recipe rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[12.5px] text-[var(--color-text)]">
                    {r.name}
                    <span className="ml-2 text-[10.5px] uppercase tracking-wide text-faint">{r.kind}</span>
                  </span>
                  <button type="button" onClick={() => copy(key, r.code)} className="font-mono text-[11px] text-[var(--color-brand)] hover:underline" aria-label={`copy the ${r.name} snippet`}>
                    {copied === key ? "copied" : "copy"}
                  </button>
                </div>
                <pre className="sql mt-2 max-h-56 overflow-auto whitespace-pre text-[11.5px]">{r.code}</pre>
                {r.note ? <p className="mt-2 text-[11.5px] leading-snug text-muted">{r.note}</p> : null}
                <p className="mt-1.5 font-mono text-[10.5px] text-faint">checked against {r.source}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
