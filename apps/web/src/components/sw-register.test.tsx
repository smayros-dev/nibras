import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SW_VERSION } from '../lib/sw-version';
import { renderWithIntl, tr } from '../test/render';
import { SwRegister } from './sw-register';

/** Minimal `EventTarget`-backed fakes of a registration, its workers and the container. */
class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage = vi.fn();
  become(state: string) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  startUpdate() {
    const worker = new FakeWorker();
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
}

class FakeContainer extends EventTarget {
  controller: object | null = null;
  registration = new FakeRegistration();
  register = vi.fn(async () => this.registration);
  stale = { unregister: vi.fn(async () => true) };
  getRegistrations = vi.fn(async () => [this.stale]);
}

// jsdom lacks pointer capture; Radix Toast's swipe handling calls it when its content is clicked.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
}

let container: FakeContainer;
const reload = vi.fn();

beforeEach(() => {
  container = new FakeContainer();
  Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
  vi.stubGlobal('location', { ...window.location, reload });
});

afterEach(() => {
  // @ts-expect-error -- removing the test double
  delete navigator.serviceWorker;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  reload.mockReset();
});

describe('SwRegister', () => {
  it('in development, registers nothing and unregisters any existing worker', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    renderWithIntl(<SwRegister />);
    await waitFor(() => expect(container.stale.unregister).toHaveBeenCalled());
    expect(container.register).not.toHaveBeenCalled();
  });

  describe('in production', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'production');
    });

    it('registers the versioned worker for the whole origin', async () => {
      renderWithIntl(<SwRegister />);
      await waitFor(() =>
        expect(container.register).toHaveBeenCalledWith(`/sw.js?v=${SW_VERSION}`, { scope: '/' }),
      );
    });

    it('stays silent on the first install (no controller yet)', async () => {
      renderWithIntl(<SwRegister />);
      await waitFor(() => expect(container.register).toHaveBeenCalled());
      act(() => container.registration.startUpdate().become('installed'));
      expect(screen.queryByText(tr('fr', 'pwa.updateAvailable'))).not.toBeInTheDocument();
    });

    it('offers the update; reloading is the user’s choice and happens once the new worker controls', async () => {
      const ue = userEvent.setup();
      container.controller = {};
      renderWithIntl(<SwRegister />, { locale: 'ar' });
      await waitFor(() => expect(container.register).toHaveBeenCalled());
      const worker = container.registration.startUpdate();
      act(() => worker.become('installed'));
      expect(await screen.findByText(tr('ar', 'pwa.updateAvailable'))).toBeInTheDocument();
      // Nothing is applied behind the user's back (a form may be dirty).
      expect(worker.postMessage).not.toHaveBeenCalled();
      act(() => container.dispatchEvent(new Event('controllerchange')));
      expect(reload).not.toHaveBeenCalled();

      await ue.click(screen.getByRole('button', { name: tr('ar', 'pwa.reload') }));
      expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      act(() => container.dispatchEvent(new Event('controllerchange')));
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('offers an update that was already waiting when the page loaded', async () => {
      container.controller = {};
      container.registration.waiting = new FakeWorker();
      renderWithIntl(<SwRegister />);
      expect(await screen.findByText(tr('fr', 'pwa.updateAvailable'))).toBeInTheDocument();
    });
  });
});
