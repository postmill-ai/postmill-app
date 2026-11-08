import type { DesignerPreflightFinding } from './design-preflight';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const openDesignerPreflightFinding = (
  store: Store,
  finding: DesignerPreflightFinding,
  onClose: () => void,
) => {
  const state = store.getState();
  state.setCurrentOutput(finding.outputIndex);
  if (finding.clip) {
    state.setSelectedClip({ outputIndex: finding.outputIndex, ...finding.clip });
  } else {
    state.setCurrentPage(finding.pageNumber);
    state.setSelectedIds(finding.elementId ? [finding.elementId] : []);
  }
  onClose();
};
