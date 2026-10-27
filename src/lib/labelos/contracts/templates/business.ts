import { lawClause, noticesClause, notice, parties, signaturesClause, termClause, wholeAgreementClause, type TemplateDef } from './shared';

export const management: TemplateDef = {
  type: 'management',
  name: 'Management agreement',
  version: 1,
  summary: 'A manager guides an artist’s career for a commission on the artist’s income.',
  slots: [
    { role: 'manager', label: 'Manager', required: true },
    { role: 'artist', label: 'Artist', required: true },
  ],
  suggestedFields: ['commission_rate', 'option_periods', 'exclusivity', 'notice_days', 'governing_law'],
  clauses: [
    notice(),
    parties('This management agreement is made between {{party.manager}} of {{party.manager.address}} (the “Manager”) and {{party.artist}} of {{party.artist.address}} (the “Artist”).'),
    {
      id: 'appointment',
      heading: 'Appointment',
      body: 'The Artist appoints the Manager, on an {{exclusivity}} basis, to advise and represent the Artist in their career: deals, bookings, press and business planning.',
    },
    termClause('The term may be extended by up to {{option_periods}} option period(s) by written notice.'),
    {
      id: 'commission',
      heading: 'Commission',
      body: 'The Artist pays the Manager {{commission_rate}}% of the Artist’s gross income from work done during the term. No commission is due on money the Artist earns after the term from work started before it, except as the parties agree.',
    },
    {
      id: 'expenses',
      heading: 'Expenses',
      body: 'The Manager asks the Artist’s approval before spending more than a small amount on the Artist’s behalf and keeps records the Artist may ask to see.',
    },
    {
      id: 'ending',
      heading: 'Ending the agreement',
      body: 'Either party may end the agreement with {{notice_days}} days’ written notice.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const nda: TemplateDef = {
  type: 'nda',
  name: 'Non-disclosure agreement',
  version: 1,
  summary: 'One party shares unreleased or private material and the other promises to keep it confidential.',
  slots: [
    { role: 'disclosing', label: 'Disclosing party', required: true },
    { role: 'receiving', label: 'Receiving party', required: true },
  ],
  suggestedFields: ['confidentiality_years', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This non-disclosure agreement is made between {{party.disclosing}} of {{party.disclosing.address}} (the “Disclosing Party”) and {{party.receiving}} of {{party.receiving.address}} (the “Receiving Party”).'),
    {
      id: 'confidential',
      heading: 'Confidential material',
      body: 'Confidential material means unreleased music, lyrics, artwork, plans, contracts and contact details that the Disclosing Party shares with the Receiving Party, in any form, whether or not it is marked confidential.',
    },
    termClause(),
    {
      id: 'duty',
      heading: 'What the Receiving Party promises',
      body: 'The Receiving Party keeps the confidential material secret, uses it only to discuss or carry out the work the parties are exploring, does not copy or share it with anyone who does not need it, and returns or deletes it when asked.',
    },
    {
      id: 'exceptions',
      heading: 'Exceptions',
      body: 'The promise does not cover material that is already public without the Receiving Party’s fault, that the Receiving Party already had, or that the law requires the Receiving Party to disclose (after telling the Disclosing Party where the law allows).',
    },
    {
      id: 'length',
      heading: 'How long it lasts',
      body: 'The duty of confidence lasts for {{confidentiality_years}} year(s) after this agreement ends.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};
