import { lawClause, noticesClause, notice, parties, signaturesClause, termClause, wholeAgreementClause, type TemplateDef } from './shared';

export const producer: TemplateDef = {
  type: 'producer',
  name: 'Producer agreement',
  version: 1,
  summary: 'A producer is engaged to produce a record for a fee and, optionally, a royalty.',
  slots: [
    { role: 'client', label: 'Client (label or artist)', required: true },
    { role: 'producer', label: 'Producer', required: true },
  ],
  suggestedFields: ['currency', 'advance', 'fee', 'royalty_rate', 'publishing_share', 'delivery_date', 'credit_line', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This producer agreement is made between {{party.client}} of {{party.client.address}} (the “Client”) and {{party.producer}} of {{party.producer.address}} (the “Producer”).'),
    {
      id: 'services',
      heading: 'Production services',
      body: 'The Producer produces {{song.title}} for {{artist.name}} and delivers the agreed material by {{delivery_date}}: {{deliverables}}.',
    },
    termClause(),
    {
      id: 'fee',
      heading: 'Fee and advance',
      body: 'The Client pays the Producer a fee of {{currency}} {{fee}}, of which {{currency}} {{advance}} is paid in advance. The advance is part of the fee and can be earned back from any royalty.',
    },
    {
      id: 'royalty',
      heading: 'Royalty',
      body: 'The Producer also receives a royalty of {{royalty_rate}}% of net receipts from the recording, and {{publishing_share}}% of the publishing in any composition the Producer helped write.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'The Client credits the Producer on every release as: {{credit_line}}.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const workForHire: TemplateDef = {
  type: 'work_for_hire',
  name: 'Work made for hire',
  version: 1,
  summary: 'A person is paid to make something and the client owns the result from the start.',
  slots: [
    { role: 'client', label: 'Client', required: true },
    { role: 'provider', label: 'Creator', required: true },
  ],
  suggestedFields: ['currency', 'fee', 'deliverables', 'delivery_date', 'credit_line', 'governing_law'],
  clauses: [
    notice(),
    parties('This agreement is made between {{party.client}} of {{party.client.address}} (the “Client”) and {{party.provider}} of {{party.provider.address}} (the “Creator”).'),
    {
      id: 'work',
      heading: 'The work',
      body: 'The Creator makes the following for the Client: {{deliverables}}, and delivers it by {{delivery_date}}.',
    },
    termClause(),
    {
      id: 'ownership',
      heading: 'Ownership',
      body: 'The work is made for hire. As far as the law allows, the Client owns it from the moment it is made, and where the law does not allow that, the Creator assigns all rights in it to the Client.',
    },
    {
      id: 'fee',
      heading: 'Fee',
      body: 'The Client pays the Creator {{currency}} {{fee}}, which is the whole payment for the work and for the rights above.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'Where credits are given, the Client credits the Creator as: {{credit_line}}.',
    },
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const session: TemplateDef = {
  type: 'session',
  name: 'Session / engineer agreement',
  version: 1,
  summary: 'A musician or engineer is booked for a session and paid a fee; the client owns the recording.',
  slots: [
    { role: 'client', label: 'Client', required: true },
    { role: 'engineer', label: 'Session musician / engineer', required: true },
  ],
  suggestedFields: ['currency', 'fee', 'deliverables', 'delivery_date', 'credit_line', 'governing_law'],
  clauses: [
    notice(),
    parties('This session agreement is made between {{party.client}} of {{party.client.address}} (the “Client”) and {{party.engineer}} of {{party.engineer.address}} (the “Engineer”).'),
    {
      id: 'session',
      heading: 'The session',
      body: 'The Engineer works on {{song.title}} for {{artist.name}} and provides: {{deliverables}}, by {{delivery_date}}.',
    },
    termClause(),
    {
      id: 'fee',
      heading: 'Fee',
      body: 'The Client pays the Engineer a flat fee of {{currency}} {{fee}} for the session. No royalty is due unless this agreement says so.',
    },
    {
      id: 'ownership',
      heading: 'Ownership',
      body: 'The Client owns the recordings made in the session. The Engineer keeps no claim to them beyond the credit below.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'Where credits are given, the Client credits the Engineer as: {{credit_line}}.',
    },
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const mixingMastering: TemplateDef = {
  type: 'mixing_mastering',
  name: 'Mixing / mastering agreement',
  version: 1,
  summary: 'An engineer mixes or masters a record for a fee; revisions and delivery formats are set.',
  slots: [
    { role: 'client', label: 'Client', required: true },
    { role: 'engineer', label: 'Mixing / mastering engineer', required: true },
  ],
  suggestedFields: ['currency', 'fee', 'deliverables', 'delivery_date', 'credit_line', 'governing_law'],
  clauses: [
    notice(),
    parties('This mixing and mastering agreement is made between {{party.client}} of {{party.client.address}} (the “Client”) and {{party.engineer}} of {{party.engineer.address}} (the “Engineer”).'),
    {
      id: 'work',
      heading: 'The work',
      body: 'The Engineer mixes and/or masters {{song.title}} and delivers: {{deliverables}}, by {{delivery_date}}.',
    },
    termClause(),
    {
      id: 'revisions',
      heading: 'Revisions',
      body: 'The fee includes the revisions the parties agree in writing. Further revisions can be charged at a rate the parties agree before the work starts.',
    },
    {
      id: 'fee',
      heading: 'Fee',
      body: 'The Client pays the Engineer {{currency}} {{fee}}. The final files are released to the Client when the fee is paid.',
    },
    {
      id: 'ownership',
      heading: 'Ownership and credit',
      body: 'The Client owns the mixed and mastered recordings. The Engineer is credited as: {{credit_line}}.',
    },
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};
