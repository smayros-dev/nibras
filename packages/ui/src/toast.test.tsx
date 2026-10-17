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
      <ToastProvider labels={{ close: 'Fermer' }}>
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

  it('swipes toward inline-end in both directions', () => {
    expect(swipeDirectionFor('ltr')).toBe('right');
    expect(swipeDirectionFor('rtl')).toBe('left');
  });

  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger title="x" />)).toThrow(/ToastProvider/);
  });
});
