import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Users } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { EmptyState } from './empty-state';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('EmptyState', () => {
  it('renders title (h2), description, decorative icon and exposes the action', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <EmptyState
        icon={<Users />}
        title="Aucun membre"
        description="Invitez votre premier professeur."
        action={
          <Button variant="primary" onClick={onClick}>
            Inviter
          </Button>
        }
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Aucun membre' })).toBeInTheDocument();
    expect(screen.getByText('Invitez votre premier professeur.')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Inviter' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('title level is configurable', () => {
    render(<EmptyState title="Rien" as="h3" />);
    expect(screen.getByRole('heading', { level: 3, name: 'Rien' })).toBeInTheDocument();
  });

  it('uses only logical utilities', () => {
    const { container } = render(<EmptyState icon={<Users />} title="t" description="d" />);
    expectNoPhysicalClasses(container);
  });
});
