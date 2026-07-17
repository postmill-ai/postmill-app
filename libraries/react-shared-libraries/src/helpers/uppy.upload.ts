import XHRUpload from '@uppy/xhr-upload';
import Transloadit from '@uppy/transloadit';
const fetchUploadApiEndpoint = async (
  fetch: any,
  endpoint: string,
  data: any
) => {
  const res = await fetch(`/media/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  return res.json();
};

// Define the factory to return appropriate Uppy configuration
export const getUppyUploadPlugin = (
  provider: string,
  fetch: any,
  backendUrl: string,
  transloadit: string[] = []
) => {
  switch (provider) {
    case 'transloadit':
      return {
        plugin: Transloadit,
        options: {
          waitForEncoding: true,
          alwaysRunAssembly: true,
          assemblyOptions: {
            params: {
              auth: { key: transloadit[0] },
              template_id: transloadit[1],
            },
          },
        },
      };
    case 'local':
      return {
        plugin: XHRUpload,
        options: {
          endpoint: `${backendUrl}/files/upload-server`,
          withCredentials: true,
          formData: true,
          allowedMetaFields: ['folderId'],
        },
      };

    // Add more cases for other cloud providers
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
};
