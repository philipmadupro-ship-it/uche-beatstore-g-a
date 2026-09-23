// @vitest-environment jsdom

/**
 * Inline editing fails in ways a build never catches: a field that discards on
 * blur throws away typing whenever the user clicks elsewhere, and a field that
 * saves on Escape saves the edit the user just abandoned. Both look correct on
 * screen.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { InlineText } from './InlineText';

afterEach(cleanup);

const field = () => screen.getByLabelText('Title') as HTMLInputElement;

function renderField(onSave = vi.fn(), value = 'Midnight Tape') {
  const utils = render(<InlineText label="Title" value={value} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit Title' }));
  return { ...utils, onSave };
}

describe('InlineText', () => {
  it('shows the value with an edit affordance until clicked', () => {
    const onSave = vi.fn();
    render(<InlineText label="Title" value="Midnight Tape" onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Edit Title' }).textContent).toContain('Midnight Tape');
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('saves on Enter', async () => {
    const { onSave } = renderField();
    fireEvent.change(field(), { target: { value: 'Night Tape' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Night Tape'));
  });

  it('saves on blur rather than discarding the edit', async () => {
    const { onSave } = renderField();
    fireEvent.change(field(), { target: { value: 'Night Tape' } });
    fireEvent.blur(field());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Night Tape'));
  });

  it('discards on Escape and does not re-save through the resulting blur', async () => {
    const { onSave } = renderField();
    const input = field();
    fireEvent.change(input, { target: { value: 'Oops' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Title' })).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Edit Title' }).textContent).toContain('Midnight Tape');
  });

  it('does not PATCH when the value is unchanged', async () => {
    const { onSave } = renderField();
    fireEvent.blur(field());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Title' })).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('trims before comparing and before saving', async () => {
    const { onSave } = renderField();
    fireEvent.change(field(), { target: { value: '  Midnight Tape  ' } });
    fireEvent.blur(field());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Title' })).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('stays open when the save is rejected, keeping the typing', async () => {
    const onSave = vi.fn().mockResolvedValue(false);
    renderField(onSave);
    fireEvent.change(field(), { target: { value: '9999' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(field().value).toBe('9999');
  });

  it('treats Enter as a newline in multiline and saves on Cmd+Enter', async () => {
    const onSave = vi.fn();
    render(<InlineText label="Notes" value="one" multiline onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Notes' }));
    const area = screen.getByLabelText('Notes');
    fireEvent.change(area, { target: { value: 'one\ntwo' } });
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('one\ntwo'));
  });
});
