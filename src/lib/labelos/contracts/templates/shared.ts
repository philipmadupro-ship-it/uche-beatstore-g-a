/**
 * Shared pieces of the platform default templates (LABEL-57).
 *
 * EVERY WORD IN `templates/*` IS PLACEHOLDER WORDING. It is not legal advice
 * and it was not written by a lawyer: the first clause of every platform
 * template says so, a test holds that, and the owner or their counsel replaces
 * the text in the template editor (which saves an organization's own versioned
 * copy; the platform default never changes underneath a contract — contracts
 * snapshot the clauses they were made from).
 */
import type { PartyRole, TemplateTypeId } from '../types';

export const NOT_LEGAL_ADVICE = 'Not legal advice — have counsel review';

export type TemplateClause = {
  /** Stable within a template; `[a-z0-9_-]`. */
  id: string;
  heading: string;
  /** Plain text with `{{merge fields}}`. Blank lines separate paragraphs. */
  body: string;
};

export type PartySlot = {
  role: PartyRole;
  label: string;
  required: boolean;
  /** More than one party may take the role (co-writers). */
  many?: boolean;
};

export type TemplateDef = {
  type: TemplateTypeId;
  name: string;
  /** Platform version. Bumped when the wording changes; a contract records the one it was made from. */
  version: number;
  summary: string;
  slots: readonly PartySlot[];
  clauses: readonly TemplateClause[];
  /** Fields a person normally fills in for this type, in the order the form shows them (all appear in the clauses). */
  suggestedFields: readonly string[];
};

export function notice(): TemplateClause {
  return {
    id: 'notice',
    heading: 'Notice',
    body: `${NOT_LEGAL_ADVICE}. This is placeholder wording provided as a starting point only. It has not been reviewed by a lawyer and may not suit your situation, your territory or the rights involved. Replace it with wording your counsel has approved before anyone signs.`,
  };
}

export function parties(text: string): TemplateClause {
  return { id: 'parties', heading: 'Parties', body: text };
}

export function termClause(extra = ''): TemplateClause {
  return {
    id: 'term',
    heading: 'Term and territory',
    body: `This agreement starts on {{contract.effective_date}} and runs for {{contract.term}}, unless ended earlier under its terms. It applies in the following territory: {{contract.territory}}.${extra ? `\n\n${extra}` : ''}`,
  };
}

export function lawClause(): TemplateClause {
  return {
    id: 'law',
    heading: 'Governing law',
    body: 'This agreement is governed by {{governing_law}}. The parties will try to settle any dispute by talking first, and will go to the courts of that place only if that does not work.',
  };
}

export function wholeAgreementClause(): TemplateClause {
  return {
    id: 'whole-agreement',
    heading: 'Whole agreement and changes',
    body: 'This agreement is the whole agreement between the parties about its subject. A change is valid only if it is in writing and every party agrees to it.',
  };
}

export function noticesClause(): TemplateClause {
  return {
    id: 'notices',
    heading: 'Notices',
    body: 'A notice under this agreement is given in writing to the address each party has stated, or to the address it later tells the others in writing, and is treated as received {{notice_days}} days after it is sent unless it is handed over sooner.',
  };
}

export function signaturesClause(): TemplateClause {
  return {
    id: 'signatures',
    heading: 'Signatures',
    body: 'Each party signs this agreement to show it has read it and agrees to it. A copy signed electronically counts as a signed copy.',
  };
}
