/**
 * One colour per class, used on every page so Kids, Junior and Youth are recognised at a glance.
 * Classes added later take the spare colours in the order they appear in Settings.
 */
const CLASS_COLOURS: Record<string, string> = {
  kids: '#e8457c',     // rose
  junior: '#3567e8',   // blue
  youth: '#0f9f6e',    // green
  adult: '#7c3aed',    // violet
  online: '#e07a10',   // amber
};
const SPARE = ['#0e9aa7', '#b4447a', '#5b6b84', '#a16207', '#4f46e5'];

export function classColour(name: string | null | undefined, allNames: string[] = []): string {
  const key = (name ?? '').trim().toLowerCase();
  if (CLASS_COLOURS[key]) return CLASS_COLOURS[key];
  const others = allNames.filter(n => !CLASS_COLOURS[n.trim().toLowerCase()]);
  const i = others.findIndex(n => n.trim().toLowerCase() === key);
  return SPARE[(i < 0 ? 0 : i) % SPARE.length];
}
