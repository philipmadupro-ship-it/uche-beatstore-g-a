// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { VisualizerModeSwitch } from './VisualizerModeSwitch';
import type { VisualMode } from '@/lib/visuals/modes';

afterEach(cleanup);

function Harness({ onChange }: { onChange?: (m: VisualMode) => void }) {
  const [m, setM] = useState<VisualMode>('terrain');
  return <VisualizerModeSwitch mode={m} onChange={(x) => { setM(x); onChange?.(x); }} />;
}

describe('VisualizerModeSwitch', () => {
  it('is a radiogroup with one checked, focusable radio', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'Visual style' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });
  it('arrow keys select and move focus; Home/End jump', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const terrain = screen.getByRole('radio', { name: 'Terrain' });
    terrain.focus();
    fireEvent.keyDown(terrain, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('curve');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Curve' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('meters');
    fireEvent.click(screen.getByRole('radio', { name: 'Orbit' }));
    expect(screen.getByRole('radio', { name: 'Orbit' }).getAttribute('aria-checked')).toBe('true');
  });
});
