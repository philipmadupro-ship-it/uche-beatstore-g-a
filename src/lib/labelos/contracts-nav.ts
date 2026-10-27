/**
 * Who gets the Contracts page (LABEL-57). Pure. The page lists what the
 * caller may read, so the link is for anyone who could have something there:
 * contracts staff (`contracts.read`), a roster artist or rights reader
 * (their own contracts, once sent) and an own-line member (a party). The
 * module (`contracts`) and the org kind are checked by the caller.
 */
export function canSeeContracts(caps: ReadonlySet<string>): boolean {
  return caps.has('contracts.read') || caps.has('rights.read') || caps.has('rights.read.own_line');
}

/** The template editor is for those who write contracts. */
export function canSeeContractTemplates(caps: ReadonlySet<string>): boolean {
  return caps.has('contracts.read');
}
