// @vitest-environment jsdom

/**
 * The Team and roster editor (LABEL-50): the one set of forms behind the
 * wizard's third step and the Team page. What it offers follows the viewer's
 * permissions and the org's face; what it holds is `TeamRosterEntries`, which
 * `entryProblems` / the runner turn into requests (tested in lib/labelos).
 */
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TeamRosterEditor, type TeamRosterEditorProps } from './TeamRosterEditor';
import { availableAdds, emptyPerson, type TeamRosterEntries } from '@/lib/labelos/team-roster';

afterEach(cleanup);

const FULL = { members: true, catalog: true, wholeOrg: true, external: true };
const empty = (): TeamRosterEntries => ({ artists: [], people: [], collaborators: [] });

let latest: TeamRosterEntries;
function Harness(props: Partial<TeamRosterEditorProps> & { start?: TeamRosterEntries; orgKind?: 'label' | 'artist' }) {
  const kind = props.orgKind ?? 'label';
  const [entries, setEntries] = useState<TeamRosterEntries>(props.start ?? empty());
  return (
    <TeamRosterEditor
      orgKind={kind}
      entries={entries}
      onChange={(e) => {
        latest = e;
        setEntries(e);
      }}
      disabled={false}
      adds={availableAdds(kind, FULL)}
      {...props}
    />
  );
}

describe('TeamRosterEditor', () => {
  it('a label gets roster, people and collaborators', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Add artist' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a person' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add collaborator' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Roster artists' })).toBeTruthy();
  });

  it('the independent face has no roster and calls the others "Your collaborators"', () => {
    render(<Harness orgKind="artist" />);
    expect(screen.queryByRole('button', { name: 'Add artist' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your collaborators' })).toBeTruthy();
    const note = screen.getByTestId('roster-solo-note');
    expect(note.textContent).toMatch(/your collaborators/i);
    expect(document.body.textContent).not.toMatch(/roster/i);
  });

  it('shows only what the viewer may add', () => {
    render(<Harness adds={availableAdds('label', { ...FULL, members: false, catalog: false })} />);
    expect(screen.queryByRole('button', { name: 'Add artist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a person' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add collaborator' })).toBeNull();
  });

  it('an artist login can only be asked for once there is an address to send it to', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    const box = screen.getByRole('checkbox', { name: 'Invite artist 1 to sign in' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'n@x.test' } });
    expect(box.disabled).toBe(false);
    fireEvent.click(box);
    expect(latest.artists[0]).toMatchObject({ email: 'n@x.test', invite: true });
  });

  it('a member can be limited to artists being added, and follows an artist who is renamed', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    fireEvent.change(screen.getByLabelText('Artist name'), { target: { value: 'Nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    const person = screen.getByTestId('team-row');
    fireEvent.click(within(person).getByRole('radio', { name: 'Selected artists' }));
    fireEvent.click(within(person).getByRole('switch', { name: 'Nova' }));
    expect(latest.people[0]).toMatchObject({ scope: 'artists', artists: ['Nova'] });
    fireEvent.change(screen.getByLabelText('Artist name'), { target: { value: 'Nova Q' } });
    expect(latest.people[0].artists).toEqual(['Nova Q']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove artist 1' }));
    expect(latest.people[0].artists).toEqual([]);
  });

  it('offers no artist scope when there is no artist to scope to, and an admin never has one', () => {
    render(<Harness start={{ ...empty(), people: [emptyPerson()] }} />);
    expect(screen.queryByRole('radio', { name: 'Selected artists' })).toBeNull();
    cleanup();
    render(<Harness start={{ ...empty(), people: [{ ...emptyPerson(), role: 'admin' }] }} existingArtists={[{ key: 'c1', name: 'Kai' }]} />);
    expect(screen.queryByRole('radio', { name: 'Selected artists' })).toBeNull();
  });

  it('existing roster artists can be picked for a member (live)', () => {
    render(<Harness start={{ ...empty(), people: [emptyPerson()] }} existingArtists={[{ key: 'c1', name: 'Kai' }]} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Selected artists' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Kai' }));
    expect(latest.people[0].artists).toEqual(['c1']);
  });

  it('creating a login fills in a password to hand over; inviting does not', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Create their login' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).value.length).toBeGreaterThanOrEqual(10);
    expect(latest.people[0].mode).toBe('login');
  });

  it('a collaborator offers a project only where the viewer may invite to one', () => {
    const start = { ...empty(), collaborators: [{ name: 'Kai', email: '', kind: 'rapper' as const, projectId: '', projectRole: 'viewer' as const }] };
    render(<Harness start={start} projects={[{ id: 'p1', name: 'Night Shift' }]} />);
    expect(screen.getByRole('button', { name: 'Project for collaborator 1' })).toBeTruthy();
    cleanup();
    render(<Harness start={start} projects={[{ id: 'p1', name: 'Night Shift' }]} adds={availableAdds('label', { ...FULL, external: false })} />);
    expect(screen.queryByRole('button', { name: 'Project for collaborator 1' })).toBeNull();
    cleanup();
    render(<Harness start={start} projects="failed" />);
    expect(screen.getByRole('alert').textContent).toMatch(/could not load the projects/i);
  });

  it('clearing the address un-ticks the artist login, and retyping a name from empty keeps a member on that artist', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    fireEvent.change(screen.getByLabelText('Artist name'), { target: { value: 'Nova' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'n@x.test' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Invite artist 1 to sign in' }));
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: '' } });
    expect(latest.artists[0].invite).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Add a person' }));
    const person = screen.getByTestId('team-row');
    fireEvent.click(within(person).getByRole('radio', { name: 'Selected artists' }));
    fireEvent.click(within(person).getByRole('switch', { name: 'Nova' }));
    fireEvent.change(screen.getByLabelText('Artist name'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Artist name'), { target: { value: 'Nova' } });
    expect(latest.people[0].artists).toEqual(['Nova']);
  });
});
