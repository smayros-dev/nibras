import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Card } from './card';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Card', () => {
  it('renders header, title (h2 by default), description, content and footer', () => {
    render(
      <Card data-testid="card">
        <Card.Header>
          <Card.Title>Profil</Card.Title>
          <Card.Description>Vos informations</Card.Description>
        </Card.Header>
        <Card.Content>Contenu</Card.Content>
        <Card.Footer>
          <Button variant="primary">Enregistrer</Button>
        </Card.Footer>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Profil' })).toBeInTheDocument();
    expect(screen.getByText('Vos informations').tagName).toBe('P');
    expect(screen.getByTestId('card').className).toMatch(/(^|\s)p-\d/);
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
  });

  it('title can be an h3 and padding can be none (tables inside cards)', () => {
    render(
      <Card padding="none" data-testid="card">
        <Card.Title as="h3">Membres</Card.Title>
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Membres' })).toBeInTheDocument();
    expect(screen.getByTestId('card').className).not.toMatch(/(^|\s)(sm:)?p-\d/);
  });

  it('uses only logical utilities', () => {
    const { container } = render(
      <Card>
        <Card.Header>
          <Card.Title>t</Card.Title>
          <Card.Description>d</Card.Description>
        </Card.Header>
        <Card.Content>c</Card.Content>
        <Card.Footer>f</Card.Footer>
      </Card>,
    );
    expectNoPhysicalClasses(container);
  });
});
