import { lawClause, noticesClause, notice, parties, signaturesClause, termClause, wholeAgreementClause, type TemplateDef } from './shared';

export const recording: TemplateDef = {
  type: 'recording',
  name: 'Recording agreement',
  version: 1,
  summary: 'A label records an artist: advance, royalty, delivery, ownership of the masters.',
  slots: [
    { role: 'label', label: 'Label', required: true },
    { role: 'artist', label: 'Artist', required: true },
  ],
  suggestedFields: ['currency', 'advance', 'royalty_rate', 'minimum_delivery', 'option_periods', 'delivery_date', 'exclusivity', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This recording agreement is made between {{party.label}} of {{party.label.address}} (the “Label”) and {{party.artist}} of {{party.artist.address}} (the “Artist”).'),
    {
      id: 'services',
      heading: 'Recording services',
      body: 'The Artist will record and deliver at least {{minimum_delivery}} finished record(s) to the Label by {{delivery_date}}. The relationship is {{exclusivity}} for recording services during the term.',
    },
    termClause('The Label may extend the term by up to {{option_periods}} option period(s) by written notice.'),
    {
      id: 'advance',
      heading: 'Advance',
      body: 'The Label pays the Artist an advance of {{currency}} {{advance}}. The advance can be earned back (recouped) from the Artist’s royalties under this agreement, and is not repayable otherwise.',
    },
    {
      id: 'royalty',
      heading: 'Royalty',
      body: 'The Label pays the Artist a royalty of {{royalty_rate}}% of the Label’s net receipts from exploiting the recordings made under this agreement, after the advance is recouped.',
    },
    {
      id: 'ownership',
      heading: 'Ownership of the recordings',
      body: 'Unless the parties agree otherwise in writing, the Label owns the master recordings made under this agreement for the term and territory. Rights in the underlying songs stay with their writers.',
    },
    {
      id: 'credit',
      heading: 'Credit and approvals',
      body: 'The Label will credit the Artist on releases as {{artist.name}}. The Artist approves the final mix and artwork of each release, which approval may not be unreasonably withheld.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const deal360: TemplateDef = {
  type: 'deal_360',
  name: '360 deal',
  version: 1,
  summary: 'A label shares in the artist’s wider income (recordings, live, merchandise, publishing) for a commission.',
  slots: [
    { role: 'label', label: 'Label', required: true },
    { role: 'artist', label: 'Artist', required: true },
  ],
  suggestedFields: ['currency', 'advance', 'royalty_rate', 'commission_rate', 'minimum_delivery', 'option_periods', 'exclusivity', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This 360 agreement is made between {{party.label}} of {{party.label.address}} (the “Label”) and {{party.artist}} of {{party.artist.address}} (the “Artist”).'),
    {
      id: 'scope',
      heading: 'What the deal covers',
      body: 'The Label supports the Artist’s career across recorded music, live performance, merchandise, brand partnerships and publishing, and in return shares in the income from those areas as set out below. The relationship is {{exclusivity}}.',
    },
    termClause('The Label may extend the term by up to {{option_periods}} option period(s) by written notice.'),
    {
      id: 'advance',
      heading: 'Advance',
      body: 'The Label pays the Artist an advance of {{currency}} {{advance}}, which can be earned back from the Artist’s share of any income stream covered by this agreement.',
    },
    {
      id: 'recordings',
      heading: 'Recordings',
      body: 'The Artist will deliver at least {{minimum_delivery}} finished record(s). For recordings the Label pays the Artist a royalty of {{royalty_rate}}% of net receipts, after the advance is recouped.',
    },
    {
      id: 'other-income',
      heading: 'Other income',
      body: 'For the other income streams covered by this agreement the Label receives a commission of {{commission_rate}}% of the Artist’s net income from that stream, measured after direct costs.',
    },
    {
      id: 'accounting',
      heading: 'Accounting',
      body: 'The Label sends the Artist a statement for each period and may be asked to show the records behind it. A payment shown as due is paid with the statement.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};

export const distribution: TemplateDef = {
  type: 'distribution',
  name: 'Distribution agreement',
  version: 1,
  summary: 'A rights owner appoints a distributor to deliver releases to stores and services.',
  slots: [
    { role: 'licensor', label: 'Rights owner', required: true },
    { role: 'provider', label: 'Distributor', required: true },
  ],
  suggestedFields: ['currency', 'advance', 'commission_rate', 'exclusivity', 'governing_law', 'notice_days'],
  clauses: [
    notice(),
    parties('This distribution agreement is made between {{party.licensor}} of {{party.licensor.address}} (the “Rights Owner”) and {{party.provider}} of {{party.provider.address}} (the “Distributor”).'),
    {
      id: 'appointment',
      heading: 'Appointment',
      body: 'The Rights Owner appoints the Distributor, on an {{exclusivity}} basis, to deliver the releases the Rights Owner supplies to digital stores and streaming services in the territory.',
    },
    termClause(),
    {
      id: 'delivery',
      heading: 'Delivery of material',
      body: 'The Rights Owner supplies audio, artwork and metadata that meet the Distributor’s published specifications, and promises it owns or controls the rights it supplies. The Distributor delivers it within a reasonable time.',
    },
    {
      id: 'fee',
      heading: 'Fee and payment',
      body: 'The Distributor keeps a fee of {{commission_rate}}% of the money it receives for the releases and pays the rest to the Rights Owner with a statement. Any advance of {{currency}} {{advance}} can be earned back from those payments.',
    },
    {
      id: 'takedown',
      heading: 'Takedown',
      body: 'The Rights Owner may ask the Distributor to remove a release on written notice. The Distributor acts on it within a reasonable time, which depends on how long each store takes.',
    },
    noticesClause(),
    lawClause(),
    wholeAgreementClause(),
    signaturesClause(),
  ],
};
