/**
 * The Axe Build mark: a 12×12 pixel-art axe.
 *
 * Drawn as a sprite rather than a path so it stays honest at any size --
 * `shapeRendering="crispEdges"` keeps every pixel square instead of letting the
 * renderer soften the staircase into something that is merely axe-shaped.
 *
 * The same grid is duplicated as static rects in app/icon.svg (the favicon),
 * which cannot import from here. If you change one, change both.
 */

const SPRITE = [
  "............",
  "..ooooooooo.",
  ".oEESSSSWWo.",
  "oEESSSSSWWo.",
  "oEESSSSSWWo.",
  ".oEESSSSWWo.",
  "..ooooooWWo.",
  ".......oWWo.",
  ".......oWWo.",
  ".......oWWo.",
  ".......oWWo.",
  ".......oooo.",
] as const;

const COLORS: Record<string, string> = {
  o: "#3f3f46", // outline -- mid-dark, so the silhouette survives a dark page
  E: "#ffffff", // the cutting edge, catching the light
  S: "#c4c4cc", // steel
  W: "#c9782f", // handle
};

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {SPRITE.flatMap((row, y) =>
        [...row].map((char, x) =>
          COLORS[char] ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORS[char]} />
          ) : null,
        ),
      )}
    </svg>
  );
}
