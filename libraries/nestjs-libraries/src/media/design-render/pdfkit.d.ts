// Minimal ambient declaration for `pdfkit` — the package ships no bundled types and
// `@types/pdfkit` is not installed. Only the surface the renderer uses is declared.
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    size?: [number, number] | string;
    margin?: number;
    margins?: { top: number; bottom: number; left: number; right: number };
    autoFirstPage?: boolean;
    compress?: boolean;
  }

  interface PDFImageOptions {
    width?: number;
    height?: number;
    fit?: [number, number];
    align?: string;
    valign?: string;
  }

  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    addPage(options?: PDFDocumentOptions): this;
    image(src: Buffer | string, x?: number, y?: number, options?: PDFImageOptions): this;
    end(): void;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export = PDFDocument;
}
