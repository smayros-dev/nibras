/**
 * Full-page navigation to a locale-prefixed path. Used by the shell menus: the `(app)` and
 * `(admin)` layouts build the nav model (current item, workspace section) from the request path,
 * and a soft `router.push` would keep the shared layout, so the sidebar would go stale.
 */
export function hardNavigate(href: string): void {
  window.location.assign(href);
}
