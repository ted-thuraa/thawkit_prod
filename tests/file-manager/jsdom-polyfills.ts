// jsdom lacks these browser APIs, which the File Manager's infinite scroll and
// Radix primitives use. Minimal no-op stand-ins are enough for behavior tests.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
const g = globalThis as Record<string, unknown>;
g.IntersectionObserver ??= NoopObserver;
g.ResizeObserver ??= NoopObserver;
if (typeof window !== "undefined") {
  window.HTMLElement.prototype.scrollIntoView ??= () => {};
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
}
