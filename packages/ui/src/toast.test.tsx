import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectionProvider } from './direction';
import { expectNoPhysicalClasses } from './test/logical-classes';
import { swipeDirectionFor, ToastProvider, useToast, type ToastOptions } from './toast';

function Trigger(options: ToastOptions) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      Go
    </button>
  );
}

function renderToast(options: ToastOptions, dir: 'ltr' | 'rtl' = 'ltr') {
  return render(
    <DirectionProvider dir={dir}>
      <ToastProvider labels={{ close: 'Fermer', region: 'Notifications', toast: 'Notification' }}>
        <Trigger {...options} />
      </ToastProvider>
    </DirectionProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Toast', () => {
  it('useToast renders a status region and auto-dismisses', () => {
    vi.useFakeTimers();
    renderToast({ title: 'Profil enregistré', variant: 'success', duration: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('listitem')).toHaveTextContent('Profil enregistré');
    // Radix fills its polite live region on the next animation frame.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Profil enregistré');
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(screen.queryByText('Profil enregistré')).not.toBeInTheDocument();
  });

  it('shows the description and a labelled close button', () => {
    renderToast({ title: 'Erreur', description: 'Réessayez', variant: 'danger' });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByText('Réessayez')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(screen.queryByText('Erreur')).not.toBeInTheDocument();
  });

  it('places the viewport with logical classes only', () => {
    renderToast({ title: 'Info' }, 'rtl');
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expectNoPhysicalClasses(document.body);
  });

  it('names the notifications region with the translated region label', () => {
    renderToast({ title: 'Info' });
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('announces danger toasts assertively', () => {
    vi.useFakeTimers();
    renderToast({ title: 'Échec', variant: 'danger' });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    act(() => {
      vi.advanceTimersByTime(50);
    });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'assertive');
    expect(status).toHaveTextContent('Notification Échec');
  });

  it('keeps the swipe-out transform when the swipe ends (no snap back)', () => {
    renderToast({ title: 'Info' });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('listitem').className).toContain(
      'data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x)',
    );
  });

  it('swipes toward inline-end in both directions', () => {
    expect(swipeDirectionFor('ltr')).toBe('right');
    expect(swipeDirectionFor('rtl')).toBe('left');
  });

  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger title="x" />)).toThrow(/ToastProvider/);
  });
});
