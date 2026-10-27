import { lawClause, noticesClause, notice, parties, signaturesClause, termClause, wholeAgreementClause, type TemplateDef } from './shared';

export const licence: TemplateDef = {
  type: 'licence',
  name: 'Licence (sync / sample)',
  version: 1,
  summary: 'A rights owner lets someone use a recording or composition in a stated way, for a fee.',
  slots: [
    { role: 'licensor', label: 'Licensor', required: true },
    { role: 'licensee', label: 'Licensee', required: true },
  ],
  suggestedFields: ['currency', 'fee', 'usage', 'sample_source', 'exclusivity', 'credit_line', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This licence is granted by {{party.licensor}} of {{party.licensor.address}} (the “Licensor”) to {{party.licensee}} of {{party.licensee.address}} (the “Licensee”).'),
    {
      id: 'grant',
      heading: 'What is licensed',
      body: 'The Licensor grants the Licensee an {{exclusivity}} licence to use {{song.title}} (the “Work”), and the sampled work {{sample_source}} where this licence names one, only for: {{usage}}. No other use is allowed.',
    },
    termClause(),
    {
      id: 'fee',
      heading: 'Fee',
      body: 'The Licensee pays the Licensor a fee of {{currency}} {{fee}}. The licence does not take effect until the fee is paid.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'Where credits are given, the Licensee credits the Work as: {{credit_line}}.',
    },
    {
      id: 'warranty',
      heading: 'Promises',
      body: 'The Licensor promises it has the right to grant this licence. The Licensee promises to use the Work only as allowed and to keep the Licensor informed of how it is released.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const beatLicence: TemplateDef = {
  type: 'beat_licence',
  name: 'Beat licence / lease',
  version: 1,
  summary: 'A producer leases a beat to an artist for a stated use, without selling the beat.',
  slots: [
    { role: 'licensor', label: 'Producer (licensor)', required: true },
    { role: 'licensee', label: 'Artist (licensee)', required: true },
  ],
  suggestedFields: ['currency', 'fee', 'lease_type', 'stream_limit', 'credit_line', 'publishing_share', 'governing_law'],
  clauses: [
    notice(),
    parties('This beat licence is made between {{party.licensor}} of {{party.licensor.address}} (the “Producer”) and {{party.licensee}} of {{party.licensee.address}} (the “Artist”).'),
    {
      id: 'grant',
      heading: 'The licence',
      body: 'The Producer grants the Artist a {{lease_type}} to record new vocals over the beat “{{song.title}}” and to release the resulting song, up to {{stream_limit}} streams. The Producer keeps ownership of the beat.',
    },
    termClause(),
    {
      id: 'fee',
      heading: 'Fee',
      body: 'The Artist pays the Producer {{currency}} {{fee}} for this lease. The licence takes effect when the fee is paid.',
    },
    {
      id: 'publishing',
      heading: 'Composition share',
      body: 'The Producer is entitled to {{publishing_share}}% of the publishing in any song made with the beat. The parties will record the split in a split sheet.',
    },
    {
      id: 'credit',
      heading: 'Credit',
      body: 'The Artist credits the Producer in the release credits and, where possible, in the metadata as: {{credit_line}}.',
    },
    {
      id: 'limits',
      heading: 'Limits',
      body: 'The Artist may not resell, re-lease or register the beat as their own, and may not use it for a purpose this licence does not name. Going beyond the stream limit needs a new licence.',
    },
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};
