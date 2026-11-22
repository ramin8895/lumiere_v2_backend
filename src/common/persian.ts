/**
 * Persian/Arabic text normalisation shared by indexing and querying.
 * Both sides MUST use the same function, otherwise matches silently fail.
 */
const DIGITS: Record<string, string> = {};
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((d, i) => (DIGITS[d] = String(i)));
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((d, i) => (DIGITS[d] = String(i)));

export function normalizeFa(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .normalize('NFKC')
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ً-ٰٟـ]/g, '') // harakat, dagger alef, tatweel
    .replace(/[‌‍‎‏]/g, ' ') // ZWNJ & friends -> space
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensFa(input: string): string[] {
  return normalizeFa(input)
    .split(' ')
    .filter((t) => t.length > 0)
    .slice(0, 8);
}
