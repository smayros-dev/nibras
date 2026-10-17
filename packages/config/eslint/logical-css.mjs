/**
 * Logical-CSS lint rule (PRD §8.16.1): class strings must not use physical left/right Tailwind
 * utilities, because direction comes from `<html dir>` and the same markup serves fr/en (LTR) and
 * ar (RTL). Matches a utility at the start of a string, after whitespace or after a variant prefix
 * (`md:`, `hover:`), optionally negative (`-mr-4`). Besides spacing/inset/radius/border/text-align it
 * covers scroll padding/margin, float/clear, `origin-*-left/right`, `bg-left/right`,
 * `object-left/right` and left/right gradients (`bg-linear-to-r`). `\x2f` is a slash (an opacity or
 * interpolation suffix): esquery's regex literal cannot contain a slash. Keep in sync with
 * `PHYSICAL_TOKEN` in `packages/ui/src/test/logical-classes.ts`.
 */
export const PHYSICAL_CLASS =
  /(^|\s|:)-?(ml|mr|pl|pr|left|right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|text-left|text-right|inset-x|scroll-ml|scroll-mr|scroll-pl|scroll-pr|float-left|float-right|clear-left|clear-right|origin-(top-|bottom-)?(left|right)|bg-(left|right)|object-(left|right)|bg-(linear|gradient)-to-[tb]?[lr])(-|\x2f|\s|$)/;

/** The one physical utility allowed: mirroring a directional icon. `PHYSICAL_CLASS` must not match it. */
export const RTL_FLIP_ALLOWED = 'rtl:-scale-x-100';

const LOGICAL_CSS_MESSAGE =
  'Physical left/right utility: use the logical form (ps/pe, ms/me, start/end, text-start/end, rounded-s/e, border-s/e). Direction comes from <html dir> (PRD §8.16.1).';

/**
 * `no-restricted-syntax` entries for physical utilities in string literals and template literal
 * chunks. Configs that set `no-restricted-syntax` must spread these together with
 * `TENANCY_SQL_RESTRICTIONS` and `SUPER_ADMIN_CROSS_TENANT_RESTRICTIONS` (rule options replace, not
 * merge).
 */
export const LOGICAL_CSS_RESTRICTIONS = [
  { selector: `Literal[value=${PHYSICAL_CLASS}]`, message: LOGICAL_CSS_MESSAGE },
  { selector: `TemplateElement[value.raw=${PHYSICAL_CLASS}]`, message: LOGICAL_CSS_MESSAGE },
];

/**
 * Test sources are exempt: their prose (test titles such as "wrong code, right code") is not markup,
 * and component tests assert rendered classes with `expectNoPhysicalClasses` instead.
 */
export const LOGICAL_CSS_EXEMPT_FILES = [
  'e2e/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.mjs',
  '**/*.spec.ts',
];
