import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Table } from './table';
import { expectNoPhysicalClasses } from './test/logical-classes';

function Members({ stackBelow }: { stackBelow?: 'md' | 'never' }) {
  return (
    <Table caption="Membres de l’espace" stackBelow={stackBelow}>
      <Table.Head>
        <Table.Row>
          <Table.Th>Nom</Table.Th>
          <Table.Th>Rôle</Table.Th>
          <Table.Th>Cours</Table.Th>
          <Table.Th>
            <span className="sr-only">Actions</span>
          </Table.Th>
        </Table.Row>
      </Table.Head>
      <Table.Body>
        <Table.Row>
          <Table.Td label="Nom">Mohamed B.</Table.Td>
          <Table.Td label="Rôle">OWNER</Table.Td>
          <Table.Td label="Cours" numeric>
            12
          </Table.Td>
          <Table.Actions>
            <Button variant="ghost" size="sm">
              Retirer
            </Button>
          </Table.Actions>
        </Table.Row>
      </Table.Body>
    </Table>
  );
}

describe('Table', () => {
  it('is a native table with a caption and column headers', () => {
    render(<Members />);
    const table = screen.getByRole('table', { name: 'Membres de l’espace' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(4);
    expect(within(table).getByRole('columnheader', { name: 'Nom' })).toHaveAttribute(
      'scope',
      'col',
    );
  });

  it('restores table roles explicitly so the stacked (display:block/grid) layout keeps its semantics', () => {
    render(<Members />);
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('role', 'table');
    const [thead, tbody] = table.querySelectorAll('thead, tbody');
    expect(thead).toHaveAttribute('role', 'rowgroup');
    expect(tbody).toHaveAttribute('role', 'rowgroup');
    for (const tr of table.querySelectorAll('tr')) expect(tr).toHaveAttribute('role', 'row');
    for (const th of table.querySelectorAll('thead th'))
      expect(th).toHaveAttribute('role', 'columnheader');
    for (const td of table.querySelectorAll('td')) expect(td).toHaveAttribute('role', 'cell');
  });

  it('a row header (scope=row) gets role=rowheader', () => {
    render(
      <Table caption="c">
        <Table.Body>
          <Table.Row>
            <Table.Th scope="row">Mohamed B.</Table.Th>
            <Table.Td label="Rôle">OWNER</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table>,
    );
    expect(screen.getByRole('rowheader', { name: 'Mohamed B.' })).toHaveAttribute(
      'role',
      'rowheader',
    );
  });

  it('cells carry data-label for the stacked layout; numeric cells align to the end', () => {
    render(<Members />);
    const cell = screen.getByRole('cell', { name: 'Mohamed B.' });
    expect(cell).toHaveAttribute('data-label', 'Nom');
    const numeric = screen.getByRole('cell', { name: '12' });
    expect(numeric.className).toContain('text-end');
    expect(numeric.className).toContain('tabular-nums');
  });

  it('stacks below md by default, never when asked', () => {
    const { unmount } = render(<Members />);
    expect(screen.getByRole('table')).toHaveAttribute('data-stack');
    expect(screen.getByRole('table')).toHaveClass('nb-table');
    unmount();
    render(<Members stackBelow="never" />);
    expect(screen.getByRole('table')).not.toHaveAttribute('data-stack');
  });

  it('the actions cell holds the row buttons', () => {
    render(<Members />);
    const actions = screen.getByRole('button', { name: 'Retirer' }).closest('td');
    expect(actions).toHaveAttribute('data-actions');
  });

  it('tokens.css defines the stacking CSS with data-label headers', () => {
    const css = readFileSync(join(import.meta.dirname, 'tokens.css'), 'utf8');
    expect(css).toMatch(/\.nb-table\[data-stack\]/);
    // Alt-text form: the label is visual only, screen readers already get the column header.
    expect(css).toMatch(/content:\s*attr\(data-label\)\s*\/\s*(""|'')/);
    expect(css).not.toMatch(/content:\s*attr\(data-label\)\s*;/);
  });

  it('uses only logical utilities', () => {
    const { container } = render(<Members />);
    expectNoPhysicalClasses(container);
  });
});
