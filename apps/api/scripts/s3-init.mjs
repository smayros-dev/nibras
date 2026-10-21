// Creates the media bucket (S3_BUCKET) when missing and sets its CORS rule so browsers can PUT
// presigned upload parts from WEB_ORIGIN and read the ETag (methods GET/PUT/HEAD). MinIO answers
// PutBucketCors with NotImplemented: it allows every origin by default, so that is not an error.
// Idempotent; never deletes anything.
//
//   pnpm --filter @nibras/api s3:init              # local: reads the root .env (dotenv-cli)
//   pnpm --filter @nibras/api s3:init -- --test    # also the per-package test buckets
//   node apps/api/scripts/s3-init.mjs              # staging, inside the api image (see
//                                                  # docs/runbooks/staging.md)
//
// `--test` creates nibras-providers-test, nibras-api-test and nibras-worker-test (derived from the
// S3_BUCKET_TEST base like the Vitest setups; the suites also create them on demand).
import { createS3StorageProviderFromEnv } from '@nibras/providers';

/** The packages whose test suites use MinIO (packages/config/vitest/test-env.mjs). */
const TEST_BUCKET_PACKAGES = ['providers', 'api', 'worker'];

const args = process.argv.slice(2).filter((a) => a !== '--');
const unknown = args.filter((a) => a !== '--test');
if (unknown.length > 0) {
  console.error(`s3:init: unknown argument(s) ${unknown.join(' ')} (only --test)`);
  process.exit(2);
}

async function initBucket(bucket, { cors }) {
  const storage = createS3StorageProviderFromEnv({ ...process.env, S3_BUCKET: bucket });
  await storage.ensureBucket();
  console.log(`s3:init: bucket ${bucket} ready`);
  if (!cors) return;
  const origin = process.env.WEB_ORIGIN;
  if (!origin) {
    console.warn('s3:init: WEB_ORIGIN is not set, CORS rule skipped');
    return;
  }
  const result = await storage.putBucketCors([new URL(origin).origin]);
  console.log(
    result === 'applied'
      ? `s3:init: CORS on ${bucket}: GET/PUT/HEAD from ${new URL(origin).origin}, ETag exposed`
      : `s3:init: CORS on ${bucket}: not implemented by this server (MinIO allows every origin)`,
  );
}

async function main() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is not set');
  await initBucket(bucket, { cors: true });
  if (args.includes('--test')) {
    // Dev-only dependency: absent from the api image, so imported only here.
    const { testBucketName } = await import('@nibras/config/vitest/test-env');
    for (const pkg of TEST_BUCKET_PACKAGES) {
      await initBucket(testBucketName(pkg, process.env), { cors: false });
    }
  }
}

main().catch((error) => {
  // The SDK error names the failing operation; never print the env (it holds S3_SECRET_KEY).
  console.error(`s3:init failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
