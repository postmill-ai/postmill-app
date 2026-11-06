import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export interface BulkZipEntry {
  name: string;
  data: Uint8Array;
  compress?: boolean;
}

export const zipBulkEntries = async (entries: BulkZipEntry[]): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const zip = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(Buffer.from(chunk));
      if (final) resolve(Buffer.concat(chunks));
    });
    try {
      for (const entry of entries) {
        const file = entry.compress === false
          ? new ZipPassThrough(entry.name)
          : new ZipDeflate(entry.name, { level: 6 });
        zip.add(file);
        file.push(entry.data, true);
      }
      zip.end();
    } catch (error) {
      reject(error);
    }
  });
