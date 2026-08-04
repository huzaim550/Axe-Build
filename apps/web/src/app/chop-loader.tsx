"use client";

import { useEffect, useRef } from "react";

/**
 * The chopping loader: a pixel lumberjack taking swings at a log while your
 * build runs.
 *
 * Seven 32x32 frames on one 224x32 sheet, drawn to a canvas at an integer
 * scale so the pixels stay square. The sheet is inlined as a data URI rather
 * than served from /public: it is 1.4 KB, the dashboard has no public
 * directory, and a loader that waits on a network request to tell you
 * something is loading is a joke at its own expense.
 */

// prettier-ignore
const SPRITE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAOAAAAAgCAYAAAALxXRVAAAFZklEQVR4nO2cQUgjVxjH/ymlh6WIiIiIZiEWCSKuuMuyFLsEEakgRcQuFkQkh1Ik9FRERBZZlhLEwyKDhJxEhC6hLCILwiIhsGEP4kocQhikGSSKiAQJsofSQ6eH7EsnZsxMZubNG837XRKdmN83L98335s3EwEOh8PhcG4bopRTrL7HF9U2rggbiijllBVhw7KIFrchRs7dg+QbyT87irEM8oailFNePutzdXKrY2UdC6e+IMVntgF8edOGd7sJiFJOkdeDAICu9tYKwdHpuceMtBa0vNf98noQopRT3u0mmPidgHUcrPxu3295PYi0nMdiLGUqlhsL8LfQtAcApp74lImAD9MApNzVtQDMKGvjcfu9G7cdnQJb80NKWs5jzO+l8mHo+Z2CdRys/G7e7+WpYu6ZLT4AMPSHJMlHAgNlv384KzjSAT6uhTSPQg9nBQ+JzcogWPHTcroxDlZ+t+73SU6y1P2AKh0QKLbf8f4WBEbHgbdv0NnbXbGd9vRjvL+lwkugXXx6ftr775Y4WPndvN+Jt28sFx+gswqqpsPrh7AaBQA8nnwBAPhjYcKK2zTE3+H1I/Trz8z8rPbfLXGw8hvxUlud/Oy3K/cMVW8huaZkxQx2EsmSNLwcQXhbdGQKUEiuaQ5iVsw4Mg3R8hvZ/xVhQxkeCqDXpvNTs3HYBSu/WS9ZmCPrGXb6ST1Y7YBVp6BqOnu7MQJAWI3i09//WnGaIrwcKfv5x++fYieRZOY3wvBQwBVx3AV/rd6t+SEFsO8zUPtJ7tlx6mO4AN3E/NwvyIoZqgsvViAfPlC8nMOhC5mhneSk0u/Sch5/7SaoHATtxFABqufcPb5mpOU8Nj6cUw1Myw8Ae6+fl9o/C78aUmgdXj8AlBIgLecBAD6H4nAKVn4t7/JUDwpzxcLLihl09naX5cRiLOVBbNp2P8k/u/JfdxV0vqEJfS2NAAD1RHi+oQnhdlBfhVL71bSl/3FkFey6P/fkXnFVGMXzAAClc2OSAKQzL8a8VGIgcVxunyF8dWnZ4Va/kfEvjTmFtYBq+WdX/huegqYuChj/vBx7uR234jRF6qKA8WgIWTGDQ4Gd34fywvu/2GYdi0FYjaJtu4CmH9qATboF6Ba/1vj/9Pufjt2NRCv/DF+G6GtphLy4WXruNG7xZ8UMPLEDHApxR6fh6hhGAgN4EBrE5fYZlqd6Kl6Xjy9RuSfWqJ+mWz3+TkIr/wwXYOqiAAA4FOKl505S7/7rMRwKcTwIDaLD6y9b9AGA5sElD40iNOqnAevxp+U3PAUlVU8enR6EevdrxiDEEb66xN7r5/jo9Sv3/c1oHlzyACg9Ouk/yUkYC+9SmRKyHn9a/po7oJ3yWqh3f7UYGgdmPTuJZEXnWxE2FDs7oZ5/LLxb4aftdgpa/prOAbWeO0W9+/ViWIylPC+f9SmRyFbZReiztiBTv123grEef1p+3emC27+Pxf2V5ONLyllbEOQ2rHx8STE7JbXDb8ZrxW8ntP26HfDo9NzzTSCEhq7RiudW5Ubg/tr965niLQAz3TIAa+eDdvitcBvHvxYs3YpW7ehgFCs7wv3a/mh4DsNDe/h2OqIb41301wJrv+V7QTcXRgEA8pG5o93kK2vX0rhf25+JzODFhPb36OrBbxTWfsOLMDexfyDpv4gi3M/9t9lvqP3ODHRpttoPx1fYXBjF/oGEpq+/MhXA5Ku4bgzcz/131W9oCnqc/3Tjtv0DCY/6/aZbMPdzfz37qxVg6T8wJaSz77Re0NXe+v5Rf/GrOOJx3lQA3M/99ezXa78D1TZ2tbe+N2VVobMKxf3cf6f9HA6Hw+FwOByOw/wHE/HYHAa975kAAAAASUVORK5CYII=";

const FW = 32;
const FH = 32;
const FRAMES = 7;
/** ms per frame. The long first one is the wind-up before the swing. */
const DURATIONS = [520, 90, 70, 150, 120, 120, 150];

// Module scope: decoded once for the tab, not once per mount. Every navigation
// between build pages would otherwise re-decode the same 1.4 KB.
const sheet = typeof Image === "undefined" ? null : new Image();
if (sheet) sheet.src = SPRITE;

export function ChopLoader({
  caption,
  /** Pixel multiplier. 4 gives a 128px figure, which is the size on a build page. */
  scale = 4,
}: {
  caption: string;
  scale?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheet) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let frame = 0;
    const drawFrame = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(sheet, frame * FW, 0, FW, FH, 0, 0, canvas.width, canvas.height);
    };

    // The progress bar already carries "this is moving", so the honest
    // reduction here is a still figure rather than a slower one.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const tick = (now: number) => {
      acc += now - last;
      last = now;
      // A backgrounded tab hands back one enormous delta; without this the
      // catch-up loop would run thousands of iterations on the next paint.
      if (acc > 2000) acc = 0;
      while (acc >= DURATIONS[frame]) {
        acc -= DURATIONS[frame];
        frame = (frame + 1) % FRAMES;
      }
      drawFrame();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      drawFrame();
      if (!still) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };

    if (sheet.complete) start();
    else sheet.addEventListener("load", start, { once: true });

    return () => {
      cancelAnimationFrame(raf);
      sheet.removeEventListener("load", start);
    };
  }, []);

  return (
    <div className="chop-loader">
      <canvas ref={canvasRef} width={FW * scale} height={FH * scale} aria-hidden="true" />
      {/* The caption is the accessible name for the whole thing; the canvas
          above it is decoration. aria-live so a screen reader hears the build
          move from one stage to the next. */}
      <div className="chop-caption" role="status" aria-live="polite">
        {caption}
        <span className="dots" aria-hidden="true" />
      </div>
    </div>
  );
}
