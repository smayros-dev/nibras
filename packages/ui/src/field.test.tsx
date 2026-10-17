import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { Input } from './input';
import { Select } from './select';
import { Textarea } from './textarea';
import { expectNoPhysicalClasses } from './test/logical-classes';

describe('Field', () => {
  it('wires label, description and error to the control', () => {
    render(
      <Field label="Email" description="Pro" error="Requis">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toMatch(/\S+ \S+/);
    expect(input).toHaveAccessibleDescription('Pro Requis');
    expect(screen.getByRole('alert')).toHaveTextContent('Requis');
  });

  it('keeps an explicit htmlFor (SP1 call sites)', () => {
    render(
      <Field htmlFor="email" label="Email">
        <Input id="email" />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('id', 'email');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('without an error keeps the control’s own invalid state (Input, Select, Textarea)', () => {
    render(
      <>
        <Field label="A">
          <Input invalid />
        </Field>
        <Field label="B">
          <Select invalid>
            <option>x</option>
          </Select>
        </Field>
        <Field label="C">
          <Textarea invalid />
        </Field>
      </>,
    );
    for (const name of ['A', 'B', 'C']) {
      expect(screen.getByLabelText(name)).toHaveAttribute('aria-invalid', 'true');
    }
  });

  it('marks required fields', () => {
    render(
      <Field label="Nom" required>
        <Input />
      </Field>,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-required', 'true');
  });

  it('keeps an existing aria-describedby on the child', () => {
    render(
      <Field label="Nom" description="Aide">
        <Input aria-describedby="external" />
      </Field>,
    );
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toMatch(/^external \S+$/);
  });

  it('uses only logical utilities', () => {
    const { container } = render(
      <Field label="x" description="d" error="e" required>
        <Input />
      </Field>,
    );
    expectNoPhysicalClasses(container);
  });
});
