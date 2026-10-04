/** Small motion helpers that respect reduced-motion and pause off-screen. */

export const reducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

/** Resolves once `el` is on screen and the tab is visible. */
export function whenVisible(el: Element): Promise<void> {
  return new Promise((resolve) => {
    const check = (onScreen: boolean) => {
      if (onScreen && document.visibilityState === 'visible') {
        io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        resolve();
      }
    };
    let onScreenNow = false;
    const io = new IntersectionObserver(([entry]) => {
      onScreenNow = Boolean(entry?.isIntersecting);
      check(onScreenNow);
    });
    const onVis = () => check(onScreenNow);
    document.addEventListener('visibilitychange', onVis);
    io.observe(el);
  });
}

/** Animate a number from `from` to `to`, calling `render` each frame. */
export function countUp(from: number, to: number, ms: number, render: (v: number) => void): Promise<void> {
  if (reducedMotion() || from === to) {
    render(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - t) ** 3;
      render(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}
