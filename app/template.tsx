/**
 * A template, not a layout, because Next re-mounts it on every navigation. That remount is the
 * whole point: each page settles in with one short rise, so moving between pages feels like one
 * continuous surface instead of a hard cut. CSS only (`.route-enter` in globals.css), so it runs
 * without hydration and is removed under reduced motion.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-enter">{children}</div>;
}
