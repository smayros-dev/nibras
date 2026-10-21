/**
 * `@nibras/contracts/web`: the zod-free part of the contracts, for browser bundles. The main entry
 * also bundles every zod schema (and zod itself, ~60 kB gzip), which a client component importing
 * one constant from `@nibras/contracts` would ship (PRD §14.1 first-load budget). Client code imports
 * values from here; type-only imports from `@nibras/contracts` are erased and stay fine.
 */
export * from './error-codes';
export * from './consents';
export * from './locale-codes';
export * from './client';
export * from './permissions';
export * from './member-statuses';
export * from './abuse-constants';
export * from './admin-constants';
export * from './invite-constants';
// SP3: courses, content & media
export * from './course-constants';
export * from './media-constants';
