import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithIntl, tr } from '../../test/render';
import { myCourse } from '../../test/learn-fixtures';
import { MyCourses } from './my-courses';

const ITEMS = [
  myCourse('c1', { title: 'Algèbre 1' }, { progressPercent: 40 }),
  myCourse(
    'c2',
    { title: 'Physique', workspace: { id: 'w2', name: 'Centre Nour' }, status: 'ARCHIVED' },
    { progressPercent: 100, completedAt: '2026-10-18T08:00:00.000Z' },
  ),
];

describe('MyCourses', () => {
  it('renders one card per course with its link, teacher, workspace and progress', () => {
    renderWithIntl(<MyCourses items={ITEMS} />);
    const cards = screen.getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const first = within(cards[0]!);
    expect(first.getByRole('link', { name: 'Algèbre 1' })).toHaveAttribute(
      'href',
      '/app/courses/c1',
    );
    expect(first.getByText(/Mohamed Ben Ali/)).toBeInTheDocument();
    expect(first.getByText(/Lycée Ibn Khaldoun/)).toBeInTheDocument();
    expect(first.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    const second = within(cards[1]!);
    expect(second.getByText(tr('fr', 'learn.completed'))).toBeInTheDocument();
    expect(second.getByText(tr('fr', 'courses.status_ARCHIVED'))).toBeInTheDocument();
  });

  it('filters by workspace', async () => {
    renderWithIntl(<MyCourses items={ITEMS} />);
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: tr('fr', 'learn.filterWorkspace') }),
      'w2',
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Physique' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Algèbre 1' })).not.toBeInTheDocument();
  });

  it('hides the filter when every course comes from one workspace', () => {
    renderWithIntl(<MyCourses items={[ITEMS[0]!]} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows the empty state', () => {
    renderWithIntl(<MyCourses items={[]} />);
    expect(screen.getByRole('heading', { name: tr('fr', 'learn.empty') })).toBeInTheDocument();
  });

  it('renders in RTL', () => {
    renderWithIntl(<MyCourses items={ITEMS} />, { locale: 'ar' });
    expect(screen.getByRole('link', { name: 'Algèbre 1' })).toBeInTheDocument();
  });
});
