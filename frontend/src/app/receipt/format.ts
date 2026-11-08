import { AppSettings, Receipt } from '../core/models';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A positive number from an input value, or 0. */
export const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return isFinite(n) && n > 0 ? n : 0;
};

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const money = (n: unknown) =>
  (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const todayIso = (d = new Date()) =>
  d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

/** "2026-11-03" → "3 Nov 2026" */
export function prettyDate(iso: string): string {
  if (!iso) return '';
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return Number(p[2]) + ' ' + MONTHS_SHORT[Number(p[1]) - 1] + ' ' + p[0];
}

/** Receipt number from the date and time down to the second, so no two collide. */
export function makeNumber(s: AppSettings, d = new Date()): string {
  const Y = d.getFullYear(), M = pad2(d.getMonth() + 1), D = pad2(d.getDate());
  const h = pad2(d.getHours()), m = pad2(d.getMinutes()), sec = pad2(d.getSeconds());
  let core: string;
  if (s.numFormat === 'epoch') core = String(Math.floor(d.getTime() / 1000));
  else if (s.numFormat === 'compact') core = String(Y).slice(2) + M + D + h + m + sec;
  else core = Y + M + D + '-' + h + m + sec;
  const p = (s.prefix || '').trim();
  return p ? p + '-' + core : core;
}

/* ---------------- amount in words ---------------- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function under1000(n: number): string {
  let out = '';
  if (n >= 100) { out += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) out += ' and '; }
  if (n >= 20) { out += TENS[Math.floor(n / 10)]; n %= 10; if (n) out += '-' + ONES[n]; }
  else if (n) { out += ONES[n]; }
  return out;
}

function whole(n: number): string {
  if (n === 0) return 'Zero';
  const units: [number, string][] = [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand']];
  const out: string[] = [];
  for (const [v, label] of units) {
    if (n >= v) { out.push(under1000(Math.floor(n / v)) + ' ' + label); n %= v; }
  }
  if (n) out.push(under1000(n));
  return out.join(' ');
}

/** 3500.5 → "Three Thousand Five Hundred Rupees and Fifty Cents Only" */
export function amountWords(total: number, currencyWord: string): string {
  const rupees = Math.floor(Math.abs(total));
  const cents = Math.round((Math.abs(total) - rupees) * 100);
  let out = whole(rupees) + ' ' + (currencyWord || 'Rupees');
  if (cents) out += ' and ' + whole(cents) + ' Cents';
  return out + ' Only';
}

/** A receipt can cover two siblings. */
export const names = (r: Receipt) =>
  r.people && r.people.length > 1 ? r.people.map(p => p.name).join(' + ') : r.student;

export const safeName = (s: string) =>
  String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

export function initials(name: string): string {
  return String(name || 'S').split(/\s+/).filter(w => /^[A-Za-z]/.test(w))
    .slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

/**
 * A phone number as WhatsApp wants it: digits only, with the country code.
 * "071 040 7740" → "94710407740"; "+44 7700 900123" keeps its own code. '' when too short.
 */
export function waNumber(raw: string | null | undefined, countryCode = '94'): string {
  const text = (raw ?? '').trim();
  let d = text.replace(/\D/g, '');
  const cc = (countryCode || '').replace(/\D/g, '');
  if (text.startsWith('+')) { /* already international */ }
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = cc + d.slice(1);
  else if (cc && !d.startsWith(cc) && d.length <= 10) d = cc + d;
  return d.length >= 8 ? d : '';
}

/** "94710407740" → "+94 71 040 7740" for showing; other countries just get the plus. */
export function prettyWa(n: string): string {
  if (!n) return '';
  const m = /^94(\d{2})(\d{3})(\d{4})$/.exec(n);
  return m ? `+94 ${m[1]} ${m[2]} ${m[3]}` : '+' + n;
}

/** Fills {parent}, {student}, {period}, {total}, {number} and {academy} in the WhatsApp message. */
export function fillMessage(template: string, v: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in v ? v[k] : all));
}
