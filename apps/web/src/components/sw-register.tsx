'use client';

import { Button, useToast } from '@tt/ui';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { SW_VERSION } from '../lib/sw-version';

/**
 * Registers `/sw.js` in production builds (in development it unregisters any worker left over, so
 * dev never serves a stale shell). When an update has installed behind an existing controller, it
 * offers a reload in a toast: the waiting worker is activated (`SKIP_WAITING`) only when the user
 * clicks, so a dirty form is never reloaded away, and the page reloads once the new worker controls.
 */
export function SwRegister() {
  const t = useTranslations('pwa');
  const { toast } = useToast();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    if (process.env.NODE_ENV !== 'production') {
      void container
        .getRegistrations()
        .then((registrations) => registrations.forEach((r) => void r.unregister()));
      return;
    }

    let cancelled = false;
    let accepted = false;
    const offered = new WeakSet<ServiceWorker>();

    const onControllerChange = () => {
      // The first install also claims the page: only reload when the user asked for the update.
      if (accepted) window.location.reload();
    };

    const offer = (worker: ServiceWorker) => {
      if (cancelled || offered.has(worker)) return;
      offered.add(worker);
      toast({
        title: t('updateAvailable'),
        description: (
          <span className="flex flex-col items-start gap-2">
            <span>{t('updateDescription')}</span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                accepted = true;
                worker.postMessage({ type: 'SKIP_WAITING' });
              }}
            >
              {t('reload')}
            </Button>
          </span>
        ),
        variant: 'info',
        duration: Infinity,
      });
    };

    const watch = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && container.controller) offer(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && container.controller) offer(worker);
        });
      });
    };

    container.addEventListener('controllerchange', onControllerChange);
    container
      .register(`/sw.js?v=${SW_VERSION}`, { scope: '/' })
      .then((registration) => {
        if (!cancelled) watch(registration);
      })
      .catch(() => {
        // No worker (private mode, blocked storage): the app works online as before.
      });

    return () => {
      cancelled = true;
      container.removeEventListener('controllerchange', onControllerChange);
    };
    // `register` is idempotent: a locale switch (new `t`) re-attaches the listeners, nothing more.
  }, [t, toast]);

  return null;
}
