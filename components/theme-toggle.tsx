"use client";

/**
 * The theme switch: system, light, dark.
 *
 * Three states rather than two, because a binary toggle has to pick a starting side and thereby
 * overrides a preference the reader already expressed to their operating system. `system` is the
 * default and it means exactly that: no `data-theme` attribute, so the `prefers-color-scheme` block
 * in globals.css decides.
 *
 * ## Why the choice is written before React runs
 *
 * The attribute is applied by an inline script in the document head (see `layout.tsx`), not here. If
 * it waited for hydration the first paint would use the default palette and then snap, which on a
 * dark-default site means a white flash for every returning light-mode reader. This component only
 * reads the state back and lets the reader change it.
 *
 * ## What it does not do
 *
 * It does not touch a verdict colour. Both palettes name their own `true`, `false`, `unknown` and
 * `noClaim` values, each checked so `unknown` still reads as absence rather than alarm, so switching
 * mode cannot collapse the one distinction this project rests on.
 */

import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";

const KEY = "kanmani.theme";

/** Applied here and in the head script. Kept in one shape so the two cannot disagree. */
function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Private browsing refuses storage. The choice still applies to this page, it just does not
    // survive a reload, which is a better outcome than throwing on a click.
  }
}

const ORDER: Choice[] = ["system", "light", "dark"];

const ICON: Record<Choice, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

const LABEL: Record<Choice, string> = {
  system: "following your system",
  light: "light",
  dark: "dark",
};

export function ThemeToggle() {
  const [choice, setChoice] = useState<Choice>("system");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      stored = null;
    }
    setChoice(stored === "light" || stored === "dark" ? stored : "system");
    setReady(true);
  }, []);

  const next = () => {
    const i = ORDER.indexOf(choice);
    const n = ORDER[(i + 1) % ORDER.length]!;
    setChoice(n);
    apply(n);
  };

  return (
    <button
      type="button"
      onClick={next}
      // Until the effect has read storage the rendered glyph would be a guess, so the control is
      // present for layout but does not announce a state it has not confirmed.
      aria-label={ready ? `Theme: ${LABEL[choice]}. Click to change.` : "Theme"}
      title={ready ? `Theme: ${LABEL[choice]}` : "Theme"}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] text-[13px] leading-none text-muted transition-colors hover:border-[var(--brand-line)] hover:text-[var(--color-text)] md:h-8 md:w-8 md:text-[12px]"
    >
      <span aria-hidden>{ready ? ICON[choice] : ICON.system}</span>
    </button>
  );
}
