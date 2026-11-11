import { createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { once } from 'events';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

interface BulkZipEntryBase {
  name: string;
  size: number;
  compress?: boolean;
}

export type BulkZipEntry = BulkZipEntryBase & (
  | { source: 'inline'; data: Uint8Array }
  | { source: 'stored'; path: string }
);

export const zipBulkEntriesToFile = async (
  entries: BulkZipEntry[],
  destination: string,
  readStoredFile: (path: string) => Promise<Readable>,
): Promise<number> => {
  const output = createWriteStream(destination);
  let outputError: Error | undefined;
  output.on('error', (error) => {
    outputError = error;
  });

  let pending = Promise.resolve();
  const zip = new Zip((error, chunk) => {
    pending = pending.then(async () => {
      if (error) throw error;
      if (outputError) throw outputError;
      if (!output.write(Buffer.from(chunk))) await once(output, 'drain');
    });
  });

  try {
    for (const entry of entries) {
      const file = entry.compress === false
        ? new ZipPassThrough(entry.name)
        : new ZipDeflate(entry.name, { level: 6 });
      zip.add(file);
      const input = entry.source === 'inline'
        ? Readable.from([entry.data])
        : await readStoredFile(entry.path);
      for await (const chunk of input) {
        file.push(new Uint8Array(chunk as Buffer), false);
        await pending;
      }
      file.push(new Uint8Array(0), true);
      await pending;
    }
    zip.end();
    await pending;
    output.end();
    await finished(output);
    return (await stat(destination)).size;
  } catch (error) {
    zip.terminate();
    output.destroy();
    await Promise.allSettled([pending, finished(output)]);
    throw error;
  }
};
