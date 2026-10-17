import { afterEach, describe, expect, it, vi } from 'vitest';
import { logout } from './logout';
import { CHALLENGE_STORAGE_KEY } from './two-factor-challenge';

function setup(fetchImpl: () => Promise<Response>) {
  const removeItem = vi.fn();
  vi.stubGlobal('fetch', vi.fn(fetchImpl));
  vi.stubGlobal('sessionStorage', { removeItem });
  const router = { replace: vi.fn(), refresh: vi.fn() };
  return { router, removeItem };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('logout', () => {
  it('posts /auth/logout, clears the 2FA challenge, then goes to login and refreshes', async () => {
    const { router, removeItem } = setup(async () => new Response(null, { status: 204 }));
    await expect(logout(router)).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(removeItem).toHaveBeenCalledWith(CHALLENGE_STORAGE_KEY);
    expect(router.replace).toHaveBeenCalledWith('/login');
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('stays put and resolves false when the API answers an error', async () => {
    const { router, removeItem } = setup(async () => new Response(null, { status: 503 }));
    await expect(logout(router)).resolves.toBe(false);
    expect(removeItem).toHaveBeenCalledWith(CHALLENGE_STORAGE_KEY);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('stays put and resolves false on a network error', async () => {
    const { router } = setup(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(logout(router)).resolves.toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
