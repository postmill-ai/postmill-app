/**
 * Single owner for the `.blurMe` dimming classes (`blur-xs pointer-events-none`
 * on the app chrome — both nav sidebars carry `blurMe`) and the body's
 * `overflow-hidden`.
 *
 * It used to have two uncoordinated imperative writers — the modal manager
 * (`new-modal.tsx`, keyed on open modals) and the billing return loader
 * (`check.payment.tsx`, keyed on its own `showLoader`). Each effect removed
 * the classes when ITS condition cleared, clobbering the other: a modal
 * closing while the loader was still up (or vice versa) stripped the classes
 * early, and a stuck writer left the nav permanently click-proof until a
 * page refresh.
 *
 * Now each contributor acquires a release token while its condition holds;
 * the classes are applied while at least one token is live and removed only
 * when the last one releases — so unmounting mid-gesture can never strand
 * them either.
 */

const BLUR_CLASSES = ['blur-xs', 'pointer-events-none'] as const;

const tokens = new Set<object>();

const apply = () => {
  const active = tokens.size > 0;
  document.body?.classList.toggle('overflow-hidden', active);
  document.querySelectorAll('.blurMe').forEach((el) => {
    el.classList.toggle(BLUR_CLASSES[0], active);
    el.classList.toggle(BLUR_CLASSES[1], active);
  });
};

/**
 * Mark the app chrome dimmed/inert until the returned release runs. The
 * release is idempotent, so an effect cleanup can call it unconditionally.
 */
export const acquireBlurMe = (): (() => void) => {
  const token = {};
  tokens.add(token);
  apply();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    tokens.delete(token);
    apply();
  };
};

/** Test hook: drop every token without applying per-token releases. */
export const resetBlurMe = () => {
  tokens.clear();
  apply();
};
