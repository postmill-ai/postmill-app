import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import { createWriteStream, chmodSync } from 'fs';
import type { WriteStream } from 'fs';
import { once } from 'events';

export class OrgArchiveWriter {
  private readonly _zip: Zip;
  private _failure?: Error;
  private _finished = false;

  private constructor(private readonly _output: WriteStream) {
    this._output.on('error', (error) => {
      this._failure = error;
    });
    this._zip = new Zip((error, chunk, final) => {
      if (error) {
        this._failure = error;
        this._output.destroy(error);
        return;
      }
      if (chunk.length) this._output.write(Buffer.from(chunk));
      if (final) {
        this._finished = true;
        this._output.end();
      }
    });
  }

  static async create(spoolPath: string): Promise<OrgArchiveWriter> {
    const output = createWriteStream(spoolPath, { flags: 'wx', mode: 0o600 });
    await Promise.race([
      once(output, 'open'),
      once(output, 'error').then(([error]) => Promise.reject(error)),
    ]);
    return new OrgArchiveWriter(output);
  }

  private async _checkpoint(): Promise<void> {
    if (this._failure) throw this._failure;
    if (!this._output.writableNeedDrain) return;
    await Promise.race([
      once(this._output, 'drain'),
      once(this._output, 'error').then(([error]) => Promise.reject(error)),
    ]);
    if (this._failure) throw this._failure;
  }

  async addJson(name: string, value: unknown, compress = true): Promise<void> {
    const entry = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    this._zip.add(entry);
    entry.push(strToU8(JSON.stringify(value)), true);
    await this._checkpoint();
  }

  async addNdjson(name: string, rows: AsyncIterable<unknown>): Promise<void> {
    const entry = new ZipDeflate(name, { level: 6 });
    this._zip.add(entry);
    for await (const row of rows) {
      entry.push(strToU8(`${JSON.stringify(row)}\n`), false);
      await this._checkpoint();
    }
    entry.push(new Uint8Array(), true);
    await this._checkpoint();
  }

  async addAsset(name: string, source: AsyncIterable<Uint8Array>, onBytes: (chunk: Uint8Array) => void): Promise<void> {
    const entry = new ZipPassThrough(name);
    this._zip.add(entry);
    for await (const chunk of source) {
      onBytes(chunk);
      entry.push(chunk, false);
      await this._checkpoint();
    }
    entry.push(new Uint8Array(), true);
    await this._checkpoint();
  }

  async finish(): Promise<void> {
    this._zip.end();
    while (!this._finished) {
      if (this._failure) throw this._failure;
      await new Promise((resolve) => setImmediate(resolve));
    }
    await Promise.race([
      once(this._output, 'close'),
      once(this._output, 'error').then(([error]) => Promise.reject(error)),
    ]);
    if (this._failure) throw this._failure;
    chmodSync(this._output.path, 0o600);
  }

  abort(): void {
    this._output.destroy();
  }
}
