import { lawClause, noticesClause, notice, parties, signaturesClause, termClause, wholeAgreementClause, type TemplateDef } from './shared';

export const feature: TemplateDef = {
  type: 'feature',
  name: 'Feature agreement',
  version: 1,
  summary: 'An artist appears on another artist’s record: fee, credit, and what the featured artist keeps.',
  slots: [
    { role: 'artist', label: 'Primary artist', required: true },
    { role: 'featured', label: 'Featured artist', required: true },
  ],
  suggestedFields: ['currency', 'fee', 'royalty_rate', 'master_share', 'publishing_share', 'credit_line', 'governing_law'],
  clauses: [
    notice(),
    parties('This feature agreement is made between {{party.artist}} of {{party.artist.address}} (the “Primary Artist”) and {{party.featured}} of {{party.featured.address}} (the “Featured Artist”).'),
    {
      id: 'performance',
      heading: 'The performance',
      body: 'The Featured Artist performs on {{song.title}}, to be released as part of {{release.title}}. The Featured Artist’s performance may be used only on that record and on promotion for it.',
    },
    termClause(),
    {
      id: 'fee',
      heading: 'Fee and royalty',
      body: 'The Primary Artist pays the Featured Artist {{currency}} {{fee}} and a royalty of {{royalty_rate}}% of net receipts from the record. The Featured Artist is entitled to {{master_share}}% of the master and {{publishing_share}}% of the composition where they wrote part of it.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'The record credits the Featured Artist as: {{credit_line}}.',
    },
    {
      id: 'exclusivity',
      heading: 'Other releases',
      body: 'The Featured Artist may not release a version of the song elsewhere without the Primary Artist’s written consent.',
    },
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const coPublishing: TemplateDef = {
  type: 'co_publishing',
  name: 'Co-writing / co-publishing agreement',
  version: 1,
  summary: 'Writers (and a publisher, if any) record how a song is owned and administered.',
  slots: [
    { role: 'collaborator', label: 'Writers', required: true, many: true },
    { role: 'publisher', label: 'Publisher', required: false },
  ],
  suggestedFields: ['publishing_share', 'commission_rate', 'credit_line', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This co-writing and co-publishing agreement is made between {{party.collaborator}} (together, the “Writers”) and, where one is named, {{party.publisher}} (the “Publisher”).'),
    {
      id: 'work',
      heading: 'The song',
      body: 'The Writers wrote {{song.title}} together. The writing shares are recorded in the split sheet for the song, and this agreement follows it. Where an entry here says otherwise, the split sheet is changed to match.',
    },
    termClause(),
    {
      id: 'ownership',
      heading: 'Ownership',
      body: 'Each Writer owns the share of the song recorded for them. Unless stated otherwise the Writers each own their own writer share and the publishing share is held as {{publishing_share}}% for the party named as publisher.',
    },
    {
      id: 'administration',
      heading: 'Administration',
      body: 'The Publisher administers the song, collects its income and pays each Writer their share with a statement, keeping an administration fee of {{commission_rate}}%.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'The song is credited to the Writers as: {{credit_line}}.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const collaboration: TemplateDef = {
  type: 'collaboration',
  name: 'Collaboration agreement',
  version: 1,
  summary: 'Two or more people make something together and agree who does what and who owns it.',
  slots: [{ role: 'collaborator', label: 'Collaborators', required: true, many: true }],
  suggestedFields: ['master_share', 'publishing_share', 'deliverables', 'delivery_date', 'credit_line', 'governing_law'],
  clauses: [
    notice(),
    parties('This collaboration agreement is made between {{party.collaborator}} (together, the “Collaborators”).'),
    {
      id: 'project',
      heading: 'The project',
      body: 'The Collaborators work together on {{release.title}}, including {{song.title}}, and deliver: {{deliverables}}, by {{delivery_date}}.',
    },
    termClause(),
    {
      id: 'ownership',
      heading: 'Ownership and income',
      body: 'Unless a split sheet says otherwise, the Collaborators share the master {{master_share}}% each and the composition {{publishing_share}}% each, and share income in the same proportion.',
    },
    {
      id: 'decisions',
      heading: 'Decisions',
      body: 'The Collaborators decide together about release, licensing and promotion. If they cannot agree, nothing is released or licensed until they do.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'Every release credits the Collaborators as: {{credit_line}}.',
    },
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};
