import { PDFDocument } from 'pdf-lib';

/** Outcome of `probePdf`: the page count, or why the document is refused. */
export type PdfProbe =
  { ok: true; pageCount: number } | { ok: false; reason: 'ENCRYPTED' | 'INVALID_SIGNATURE' };

/**
 * Page count of an uploaded PDF (`pdf-lib`, spec §4.3). The input is bounded by the PDF limit
 * (50 MiB, checked by the caller before reading the object); parsing yields to the event loop
 * between object batches. A password-protected document (`/Encrypt` in the trailer) is
 * `ENCRYPTED` — the viewer could not render it; anything `pdf-lib` cannot read, or a document
 * without pages, is `INVALID_SIGNATURE` (hostile or corrupt file, never thrown: a retry would
 * fail the same way).
 */
export async function probePdf(bytes: Uint8Array): Promise<PdfProbe> {
  let doc: PDFDocument;
  try {
    // `ignoreEncryption` + `isEncrypted`: pdf-lib's ES5 build breaks `instanceof EncryptedPDFError`.
    doc = await PDFDocument.load(bytes, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
  if (doc.isEncrypted) return { ok: false, reason: 'ENCRYPTED' };
  try {
    const pageCount = doc.getPageCount();
    if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
      return { ok: false, reason: 'INVALID_SIGNATURE' };
    }
    return { ok: true, pageCount };
  } catch {
    // A malformed or cyclic page tree.
    return { ok: false, reason: 'INVALID_SIGNATURE' };
  }
}
