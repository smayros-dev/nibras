import { act, render, renderHook, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimezoneSelect } from '../components/timezone-select';
import { PRD_TIMEZONES, useTimezones } from './timezones';

/** Makes the runtime report `zone` as the browser's time zone. */
function stubResolvedZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  return vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...original.call(this), timeZone: zone };
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useTimezones', () => {
  it('renders the static PRD list first, then the runtime list with the resolved zone', async () => {
    stubResolvedZone('Asia/Tokyo');
    const renders: string[][] = [];
    const { result } = renderHook(() => {
      const value = useTimezones();
      renders.push(value.options);
      return value;
    });
    expect(renders[0]).toEqual([...PRD_TIMEZONES]);
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.resolved).toBe('Asia/Tokyo');
    expect(result.current.options).toContain('Asia/Tokyo');
    // The PRD zones stay pinned on top, without duplicates.
    expect(result.current.options.slice(0, PRD_TIMEZONES.length)).toEqual([...PRD_TIMEZONES]);
    expect(new Set(result.current.options).size).toBe(result.current.options.length);
  });

  it('keeps an unlisted initial value in the first render', () => {
    const { result } = renderHook(() => useTimezones('America/Lima'));
    expect(result.current.options).toContain('America/Lima');
  });

  it('first render is not ready and has no resolved zone (identical on server and client)', () => {
    const html = renderToString(<Probe />);
    expect(html).toContain('data-ready="false"');
    expect(html).not.toContain('data-resolved');
  });

  it('hydrates a server-rendered TimezoneSelect without a mismatch warning', async () => {
    // Server (Node ICU) and browser disagree on the zone list and the resolved zone.
    const server = stubResolvedZone('UTC');
    const serverList = vi
      .spyOn(Intl, 'supportedValuesOf')
      .mockReturnValue(['Africa/Tunis', 'UTC'] as never);
    const html = renderToString(<TimezoneSelect value="Africa/Tunis" onChange={() => {}} />);
    server.mockRestore();
    serverList.mockRestore();
    stubResolvedZone('Asia/Tokyo');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <TimezoneSelect value="Africa/Tunis" onChange={() => {}} />, {
        onRecoverableError: (error) => console.error(error),
      });
    });
    expect(errors).not.toHaveBeenCalled();
    // After the effect the full runtime list is there.
    expect(container.querySelectorAll('option').length).toBeGreaterThan(PRD_TIMEZONES.length);
    act(() => root?.unmount());
    container.remove();
  });

  it('TimezoneSelect keeps a value that is not in the list', () => {
    const { container } = render(<TimezoneSelect value="Mars/Olympus" onChange={() => {}} />);
    expect(container.querySelector('option[value="Mars/Olympus"]')).not.toBeNull();
  });
});

function Probe() {
  const { ready, resolved } = useTimezones();
  return <span data-ready={String(ready)} {...(resolved ? { 'data-resolved': resolved } : {})} />;
}
