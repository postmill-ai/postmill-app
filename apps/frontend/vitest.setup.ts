// jsdom does not implement Element.prototype.scrollTo / window.scrollTo, which
// components like the mobile sub-menu pill strip call to keep the active tab in
// view. Provide a no-op so rendering those components under jsdom doesn't throw.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = () => {};
}
if (typeof window !== 'undefined' && typeof window.scrollTo !== 'function') {
  (window as unknown as { scrollTo: () => void }).scrollTo = () => {};
}

// jsdom has no window.matchMedia; Mantine's use-color-scheme media queries need
// it. Any spec that renders a real MantineProvider relies on this shim.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  (window as unknown as { matchMedia: unknown }).matchMedia = (
    query: string
  ): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
