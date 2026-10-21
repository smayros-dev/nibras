const MiB = 1024 * 1024;

/**
 * Sends a file to a tus endpoint (Cloudflare Stream direct creator upload, spec D1) with
 * `tus-js-client`, loaded on demand (PRD §14.1 budget). `uploadUrl` is the resumable URL itself;
 * the client keeps its fingerprint in `localStorage`, so a reload picks the same upload back up
 * and only sends the missing bytes (HEAD → PATCH from the stored offset).
 */
export async function uploadTus({
  file,
  uploadUrl,
  onProgress,
  signal,
}: {
  file: File;
  uploadUrl: string;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  if (signal?.aborted) throw new DOMException('The upload was aborted', 'AbortError');
  const { Upload } = await import('tus-js-client');
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      uploadUrl,
      chunkSize: 50 * MiB,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata: { filename: file.name, filetype: file.type },
      onProgress: (sent, total) => onProgress?.(sent, total),
      onSuccess: () => resolve(),
      onError: (error) => reject(error),
    });
    signal?.addEventListener(
      'abort',
      () => {
        void upload.abort();
        reject(new DOMException('The upload was aborted', 'AbortError'));
      },
      { once: true },
    );
    upload.start();
  });
}
