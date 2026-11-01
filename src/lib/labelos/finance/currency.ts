/** ISO-4217 currencies and their minor-unit exponents (LABEL-61). A leaf module: no imports, so shared contracts can use it. */

/** Minor-unit exponent by ISO-4217 code: 10^exponent minor units per major unit. */
export const CURRENCY_EXPONENT: Readonly<Record<string, 0 | 2 | 3>> = {
  // 0 decimals
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  // 3 decimals
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  // 2 decimals
  AED: 2, ARS: 2, AUD: 2, BRL: 2, CAD: 2, CHF: 2, CNY: 2, COP: 2, CZK: 2, DKK: 2, EGP: 2, EUR: 2, GBP: 2, GHS: 2, HKD: 2,
  HUF: 2, IDR: 2, ILS: 2, INR: 2, KES: 2, MAD: 2, MXN: 2, MYR: 2, NGN: 2, NOK: 2, NZD: 2, PEN: 2, PHP: 2, PKR: 2, PLN: 2,
  RON: 2, RUB: 2, SAR: 2, SEK: 2, SGD: 2, THB: 2, TRY: 2, TWD: 2, TZS: 2, UAH: 2, USD: 2, ZAR: 2,
};

export const isCurrency = (v: unknown): v is string => typeof v === 'string' && Object.prototype.hasOwnProperty.call(CURRENCY_EXPONENT, v);

export function currencyExponent(currency: string): number {
  if (!isCurrency(currency)) throw new RangeError(`Unknown currency "${currency}"`);
  return CURRENCY_EXPONENT[currency];
}

