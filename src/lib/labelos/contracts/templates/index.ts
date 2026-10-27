/**
 * The platform default templates (LABEL-57): one for each contract type,
 * defined in code so they ship and version with the app. An organization's
 * own edits are versioned rows in `contract_templates`; a contract snapshots
 * the clauses it was made from, so neither a platform change nor an org edit
 * rewrites a contract that exists.
 */
import { TEMPLATE_TYPE_IDS, type TemplateTypeId } from '../types';
import { deal360, distribution, recording } from './recording';
import { beatLicence, licence } from './licensing';
import { mixingMastering, producer, session, workForHire } from './producers';
import { collaboration, coPublishing, feature } from './collaboration';
import { management, nda } from './business';
import type { TemplateDef } from './shared';

export type { PartySlot, TemplateClause, TemplateDef } from './shared';
export { NOT_LEGAL_ADVICE } from './shared';

const ALL: readonly TemplateDef[] = [
  recording,
  distribution,
  licence,
  deal360,
  producer,
  beatLicence,
  feature,
  coPublishing,
  management,
  collaboration,
  session,
  workForHire,
  mixingMastering,
  nda,
];

const BY_TYPE: ReadonlyMap<TemplateTypeId, TemplateDef> = new Map(ALL.map((t) => [t.type, t]));

/** The platform default for a type. Total over `TemplateTypeId` (a test holds it). */
export function platformTemplate(type: TemplateTypeId): TemplateDef {
  const t = BY_TYPE.get(type);
  if (!t) throw new Error(`no platform template for ${type}`);
  return t;
}

/** Every platform template, in the vocabulary's order. */
export function platformTemplates(): TemplateDef[] {
  return TEMPLATE_TYPE_IDS.map(platformTemplate);
}

/** The source tag a contract records when it was made from the platform default. */
export function platformSource(type: TemplateTypeId): string {
  return `platform:${type}@${platformTemplate(type).version}`;
}
