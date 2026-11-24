import { describe, expect, it } from 'vitest';
import { attributedAuthor, contactRefOf, inviteSharePatch, replyToFor } from './collaborator';

describe('attributedAuthor', () => {
  it('puts the invited contact after the typed name', () => {
    expect(attributedAuthor('Nova', 'Alex')).toBe('Nova (Alex)');
  });
  it('is just the typed name without a contact', () => {
    expect(attributedAuthor('Nova', null)).toBe('Nova');
    expect(attributedAuthor('Nova', '  ')).toBe('Nova');
  });
  it('does not repeat the same name', () => {
    expect(attributedAuthor('alex', 'Alex')).toBe('Alex');
  });
  it('falls back to the contact when no name was typed', () => {
    expect(attributedAuthor('', 'Alex')).toBe('Alex');
  });
});

describe('replyToFor', () => {
  it('accepts a normal address', () => {
    expect(replyToFor(' beats@example.com ')).toBe('beats@example.com');
  });
  it('is undefined when unset or malformed, never a fallback', () => {
    expect(replyToFor(null)).toBeUndefined();
    expect(replyToFor('')).toBeUndefined();
    expect(replyToFor('not an email')).toBeUndefined();
    expect(replyToFor('a@b.com, c@d.com')).toBeUndefined();
    expect(replyToFor('Name <a@b.com>')).toBeUndefined();
  });
});

describe('inviteSharePatch', () => {
  it('stores the address actually used and the picked contact', () => {
    expect(inviteSharePatch({ contactId: 'c1', recipient: ' typed@x.com ' })).toEqual({ invited_email: 'typed@x.com', contact_id: 'c1' });
  });
  it('leaves contact_id alone when none was picked', () => {
    expect(inviteSharePatch({ contactId: null, recipient: 'a@b.com' })).toEqual({ invited_email: 'a@b.com' });
  });
});

describe('contactRefOf', () => {
  it('returns id and name only', () => {
    expect(contactRefOf({ id: 'c1', name: ' Alex ', email: 'x@y.z' } as never)).toEqual({ id: 'c1', name: 'Alex' });
  });
  it('is null without an id', () => {
    expect(contactRefOf(null)).toBeNull();
    expect(contactRefOf({ name: 'Alex' })).toBeNull();
  });
});
