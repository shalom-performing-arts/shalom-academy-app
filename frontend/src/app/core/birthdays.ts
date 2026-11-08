import { Student } from './models';

/** A student's next birthday, counted from today (the computer's own date, Sri Lanka time). */
export interface Birthday {
  student: Student;
  /** yyyy-MM-dd */
  dob: string;
  /** the date of the next (or today's) birthday */
  next: Date;
  /** 0 = today, 1 = tomorrow … */
  daysAway: number;
  /** the age they turn on it; null when the year of birth looks wrong */
  turning: number | null;
}

/** midnight today, local time */
export function today(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** "2018-05-14" → its month and day; null for anything that is not a date */
export function parseDob(dob: string | null | undefined): { y: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dob ?? '').trim());
  if (!x) return null;
  const y = +x[1], m = +x[2], d = +x[3];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}

/** the birthday in a given year; 29 February is kept on 28 February when there is no 29th */
function inYear(m: number, d: number, year: number): Date {
  const last = new Date(year, m, 0).getDate();
  return new Date(year, m - 1, Math.min(d, last));
}

export function birthday(student: Student, dob: string, now = new Date()): Birthday | null {
  const p = parseDob(dob);
  if (!p) return null;
  const t = today(now);
  let next = inYear(p.m, p.d, t.getFullYear());
  if (next < t) next = inYear(p.m, p.d, t.getFullYear() + 1);
  const daysAway = Math.round((next.getTime() - t.getTime()) / 86_400_000);
  const turning = next.getFullYear() - p.y;
  return { student, dob, next, daysAway, turning: turning > 0 && turning < 120 ? turning : null };
}

/** how old someone is today */
export function ageOn(dob: string | null | undefined, now = new Date()): number | null {
  const p = parseDob(dob);
  if (!p) return null;
  const t = today(now);
  let age = t.getFullYear() - p.y;
  if (t < inYear(p.m, p.d, t.getFullYear())) age--;
  return age >= 0 && age < 120 ? age : null;
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th, 21st */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Saturday 14 November" */
export function prettyDay(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** "14 May 2018" */
export function prettyDob(dob: string): string {
  const p = parseDob(dob);
  return p ? new Date(p.y, p.m - 1, p.d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : dob;
}

/** the name a child is called by: the first real name, not an initial ("W.W. Divan" → "Divan") */
export function firstName(name: string): string {
  return name.trim().split(/\s+/).find(w => w.length > 2 && !w.includes('.')) ?? name.trim();
}

/**
 * Wishes for the card, written to the child. One is chosen for each child (so brothers, sisters
 * and classmates do not all get the same words), and the office can pick another.
 */
export const WISHES: string[] = [
  'Every note you play makes our world a little brighter. May your new year be filled with love, laughter and beautiful music.',
  'Watching you grow, learn and shine is one of our greatest joys. May every dream in your heart sing out loud this year.',
  'You fill our classroom with sunshine and song. We wish you a year as wonderful, kind and special as you are.',
  'Your smile is our favourite melody. May this birthday be the beginning of your most beautiful year yet.',
  'Keep singing, keep dreaming, keep shining. We are so proud of you, and so lucky to have you with us.',
  'The world is a happier place because you are in it. May your day be full of hugs, joy and your favourite songs.',
];

export function wishFor(name: string, offset = 0): string {
  const n = [...name].reduce((t, c) => t + c.charCodeAt(0), 0);
  return WISHES[(n + offset) % WISHES.length];
}

/** The message that goes with the card, to the parent. */
export function birthdayMessage(o: { parent: string; student: string; turning: number | null; academy: string; from: string }): string {
  const first = firstName(o.student);
  return [
    `Dear ${o.parent || 'Parent'},`,
    '',
    o.turning ? `Today is a very special day — happy ${ordinal(o.turning)} birthday to our dear ${first}! 🎂🎉`
      : `Today is a very special day — happy birthday to our dear ${first}! 🎂🎉`,
    '',
    `It is such a joy to watch ${first} grow, learn and shine in every class. ${first}'s smile and music fill our academy `
      + `with happiness, and we are so proud of every step of the journey so far.`,
    '',
    `May this new year bring ${first} good health, endless happiness and many beautiful songs to sing. 🎵`,
    '',
    `Thank you for sharing ${first} with us. Please give ${first} a big birthday hug from all of us! 🤗`,
    '',
    `With love and warm wishes,`,
    `${o.from || 'Your teachers'} 💖`,
    `& everyone at ${o.academy}`,
  ].join('\n');
}
