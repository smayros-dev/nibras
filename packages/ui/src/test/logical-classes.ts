import { expect } from 'vitest';

/**
 * A single class token that is a physical left/right utility (variant prefixes such as `md:` or
 * `rtl:` are stripped first). Same list as the lint rule in `@nibras/config/eslint/logical-css`; the
 * one allowed physical utility, `rtl:-scale-x-100`, does not match.
 */
export const PHYSICAL_TOKEN =
  /^-?(ml|mr|pl|pr|left|right|rounded-[lr]|rounded-[tb][lr]|border-[lr]|text-left|text-right|inset-x|scroll-ml|scroll-mr|scroll-pl|scroll-pr|float-left|float-right|clear-left|clear-right|origin-(top-|bottom-)?(left|right)|bg-(left|right)|object-(left|right)|bg-(linear|gradient)-to-[tb]?[lr])(-|\/|$)/;

/** Every class token used under `container`. */
export function classTokens(container: Element): string[] {
  return Array.from(container.querySelectorAll('[class]')).flatMap((el) =>
    (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean),
  );
}

/** Asserts that no rendered element uses a physical left/right utility (PRD §8.16.1). */
export function expectNoPhysicalClasses(container: Element): void {
  const physical = classTokens(container).filter((token) =>
    PHYSICAL_TOKEN.test(token.slice(token.lastIndexOf(':') + 1)),
  );
  expect(physical).toEqual([]);
}
