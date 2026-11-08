/**
 * A WhatsApp chat link, for the parents' registration page ("WhatsApp the academy"). The office
 * side of the app opens nothing: messages and receipts are copied and pasted into WhatsApp.
 */
export function waUrl(number: string | null | undefined, text = ''): string {
  const n = (number ?? '').replace(/\D/g, '');
  const t = text ? '?text=' + encodeURIComponent(text) : '';
  return `https://wa.me/${n}${t}`;
}
