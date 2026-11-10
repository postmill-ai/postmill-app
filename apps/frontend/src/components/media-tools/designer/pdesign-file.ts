export const replaceDesignerDesignId = (designId: string): void => {
  const url = new URL(window.location.href);
  url.searchParams.set('designId', designId);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
};

let pdesignDownloadAnchor: HTMLAnchorElement | null = null;

export const downloadPdesignArtifact = async (
  artifactUrl: string,
  designName: string
): Promise<void> => {
  const response = await window.fetch(artifactUrl);
  if (!response.ok) throw new Error('Download failed');
  const objectUrl = URL.createObjectURL(await response.blob());
  if (!pdesignDownloadAnchor?.isConnected) {
    pdesignDownloadAnchor = document.createElement('a');
    pdesignDownloadAnchor.hidden = true;
    document.body.appendChild(pdesignDownloadAnchor);
  }
  pdesignDownloadAnchor.href = objectUrl;
  pdesignDownloadAnchor.download = `${designName.replace(/[\\/"]/g, ' ').replace(/[^\w\- ]+/g, '').trim() || 'design'}.pdesign`;
  pdesignDownloadAnchor.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
};
