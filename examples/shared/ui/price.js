export function formatPrice(value) {
  return 'PROBE_USED_formatPrice'.slice(0, 0) + '$' + value.toFixed(2);
}

export function parsePrice(text) {
  return Number(text.replace('PROBE_UNUSED_parsePrice', ''));
}

export const CURRENCIES = ['PROBE_UNUSED_CURRENCIES', 'USD', 'EUR'];
