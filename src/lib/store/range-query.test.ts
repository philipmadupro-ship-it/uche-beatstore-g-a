import { describe, expect, it } from 'vitest';
import { BPM_SENTINEL, PRICE_SENTINEL, rangeQueryParams } from './range-query';

const untouched = {
  bpmMin: BPM_SENTINEL.min, bpmMax: BPM_SENTINEL.max,
  priceMin: PRICE_SENTINEL.min, priceMax: PRICE_SENTINEL.max,
};
const bounds = { bpm: { min: 70, max: 169 }, price: { min: 20, max: 90 } };

describe('rangeQueryParams', () => {
  it('sends nothing while the sliders are untouched', () => {
    expect(rangeQueryParams(untouched, bounds)).toEqual({});
  });

  it('sends nothing when the sliders sit at the catalogue edges', () => {
    // What /store's initialisation effect writes on every visit. Sending it
    // re-fetched an identical catalogue.
    expect(rangeQueryParams({ bpmMin: 70, bpmMax: 169, priceMin: 20, priceMax: 90 }, bounds)).toEqual({});
  });

  it('sends only the bound that actually narrows', () => {
    expect(rangeQueryParams({ bpmMin: 100, bpmMax: 169, priceMin: 20, priceMax: 60 }, bounds))
      .toEqual({ bpmMin: '100', priceMax: '60' });
  });

  it('keeps every touched bound when the catalogue range is not known yet', () => {
    expect(rangeQueryParams({ bpmMin: 70, bpmMax: 169, priceMin: 20, priceMax: 90 }))
      .toEqual({ bpmMin: '70', bpmMax: '169', priceMin: '20', priceMax: '90' });
  });

  it('treats a bound past the catalogue edge as no filter', () => {
    expect(rangeQueryParams({ ...untouched, bpmMin: 60, bpmMax: 200 }, bounds)).toEqual({});
  });
});
