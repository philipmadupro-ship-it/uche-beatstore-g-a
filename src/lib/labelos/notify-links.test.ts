import { describe, expect, it } from 'vitest';
import { notificationHref } from './notify-links';

const ID = '50000000-0000-4000-8000-000000000001';

describe('notificationHref', () => {
  it('opens the page of the thing a task is about', () => {
    expect(notificationHref('night-shift', { kind: 'task_assigned', data: { taskId: 't', target: { kind: 'song', id: ID } } })).toBe(`/o/night-shift/songs/${ID}`);
    expect(notificationHref('night-shift', { kind: 'task_assigned', data: { target: { kind: 'artist', id: ID } } })).toBe(`/o/night-shift/artists/${ID}`);
    expect(notificationHref('night-shift', { kind: 'task_assigned', data: { target: { kind: 'project', id: ID } } })).toBe(`/o/night-shift/projects/${ID}`);
  });

  it('falls back to the Overview ("My work") for an org-level task, a release (no page yet) or no data', () => {
    expect(notificationHref('night-shift', { kind: 'task_assigned', data: { target: null } })).toBe('/o/night-shift');
    expect(notificationHref('night-shift', { kind: 'task_assigned', data: { target: { kind: 'release', id: ID } } })).toBe('/o/night-shift');
    expect(notificationHref('night-shift', { kind: 'mention' })).toBe('/o/night-shift');
    expect(notificationHref('night-shift', { kind: 'invitation', data: 'junk' })).toBe('/o/night-shift');
  });

  it('is not for the producer bell: a producer notification kind has no org link', () => {
    expect(notificationHref('night-shift', { kind: 'purchase', data: { target: { kind: 'song', id: ID } } })).toBeNull();
  });

  it('never builds a path from malformed data: a non-uuid id falls back to the Overview', () => {
    expect(notificationHref('night-shift', { kind: 'task_assigned', data: { target: { kind: 'song', id: '../x' } } })).toBe('/o/night-shift');
  });
});
