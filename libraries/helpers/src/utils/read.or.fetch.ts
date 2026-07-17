import { readFileSync } from 'fs';
import { safeFetch } from '@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch';

export const readOrFetch = async (path: string) => {
  if (path.indexOf('http') === 0) {
    const response = await safeFetch(path, { method: 'GET' });
    return Buffer.from(await response.arrayBuffer());
  }

  return readFileSync(path);
};
