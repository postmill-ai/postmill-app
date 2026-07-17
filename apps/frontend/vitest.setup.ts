// jsdom does not implement Element.prototype.scrollTo / window.scrollTo, which
// components like the mobile sub-menu pill strip call to keep the active tab in
// view. Provide a no-op so rendering those components under jsdom doesn't throw.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = () => {};
}
if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
  (window as unknown as { scrollTo: () => void }).scrollTo = () => {};
}
