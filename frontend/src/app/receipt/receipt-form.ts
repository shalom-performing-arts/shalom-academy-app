import { LineItem, Person, Receipt, Student } from '../core/models';
import { MONTHS, num } from './format';

/** One student slot on the form. Siblings paying together use two or three. */
export interface StudentSlot {
  name: string;
  id: string;
  category: string;
  day: string;
  time: string;
  cls: string;
  /** the class session from the roster ("Andante"); not something picked on the form */
  session: string;
  monthly: number | null;
  admission: number | null;
  /** the roster record behind the slot, for the fee chip and inactive flag */
  picked: Student | null;
}

export interface ReceiptForm {
  id: string | null;          // set once the receipt is saved on the server
  number: string;
  date: string;
  /** brothers and sisters paying together: a second student, and a third when `three` is on */
  two: boolean;
  three: boolean;
  s1: StudentSlot;
  s2: StudentSlot;
  s3: StudentSlot;
  month: string;
  year: number | null;
  /** charges besides the monthly and admission fees: an exam fee, a costume … */
  extras: Extra[];
  method: string;
  /** where the money went; goes on the payment, not on the printed receipt */
  paidTo: string;
  payer: string;
  reference: string;
  note: string;
}

/** One extra charge line. 	ype is a fee type id from Settings, or 'other' for free text. */
export interface Extra {
  type: string;
  label: string;
  amount: number | null;
}

export const emptyExtra = (): Extra => ({ type: 'other', label: '', amount: null });

export function emptySlot(cls = ''): StudentSlot {
  return { name: '', id: '', category: '', day: '', time: '', cls, session: '', monthly: null, admission: null, picked: null };
}

function person(s: StudentSlot): Person {
  return {
    name: s.name.trim(),
    id: s.id.trim(),
    category: s.category.trim(),
    cls: s.cls,
    day: s.day.trim(),
    time: s.time.trim(),
    // siblings are usually in different sessions, so each child carries their own
    session: s.session,
  };
}

/** The receipt the form describes, ready to preview or save. */
export function buildReceipt(f: ReceiptForm, admissionLabel = 'Admission Fee'): Receipt {
  const year = f.year ?? new Date().getFullYear();
  const period = f.month + ' ' + year;

  const slots = [f.s1];
  if (f.two && f.s2.name.trim()) slots.push(f.s2);
  if (f.two && f.three && f.s3?.name.trim()) slots.push(f.s3);
  const people = slots.map(person);

  // With two students each fee is itemised per child, so the parent can see what was charged
  // for whom. With one, the name on every line would just be noise.
  const who = (i: number) => (people.length > 1 ? people[i].name : '');
  const items: LineItem[] = [];
  slots.forEach((s, i) => {
    const monthly = num(s.monthly);
    // `kind` is what the form reloads from; `desc` is only what is printed
    if (monthly) items.push({ kind: 'monthly', desc: f.month + ' Class Fee', sub: who(i), amount: monthly });
  });
  slots.forEach((s, i) => {
    const admission = num(s.admission);
    if (admission) items.push({ kind: 'admission', desc: admissionLabel, sub: who(i), amount: admission });
  });
  for (const x of f.extras ?? []) {
    const amount = num(x.amount);
    if (!amount) continue;
    // a fee type keeps its id, so the payment it records is filed under that type
    items.push({ ...(x.type !== 'other' ? { kind: x.type } : {}), desc: x.label.trim() || 'Other charge', sub: '', amount });
  }

  const first = people[0];
  return {
    id: f.id,
    number: f.number.trim(),
    date: f.date,
    people,
    // the first student also stays in the flat fields, so history search and CSV keep working
    student: first.name,
    studentId: first.id,
    category: first.category,
    cls: first.cls,
    session: first.session,
    day: first.day,
    time: first.time,
    month: f.month,
    year,
    period,
    items,
    total: items.reduce((t, i) => t + i.amount, 0),
    method: f.method,
    paidTo: f.paidTo,
    payer: f.payer.trim(),
    reference: f.reference.trim(),
    note: f.note.trim(),
  };
}

/** What is wrong with the receipt, or '' when it is ready to issue. */
export function problem(f: ReceiptForm, r: Receipt): string {
  if (!r.student) return 'Pick or type a student name first.';
  if (f.two && !f.s2.name.trim()) return 'Add the second student, or switch the family option off.';
  if (f.two && f.three && !f.s3?.name.trim()) return 'Add the third student, or remove that row.';
  if (!r.total) return 'Enter at least one fee amount.';
  if (!r.number) return 'Receipt number is missing.';
  return '';
}

/** Puts a saved receipt back into the form, for reprinting or correcting it. */
export function formFromReceipt(r: Receipt, findStudent: (name: string) => Student | null): ReceiptForm {
  // receipts saved before the family option have no people[]
  const people: Partial<Person>[] = r.people?.length ? r.people : [{
    name: r.student, id: r.studentId, category: r.category, cls: r.cls, day: r.day, time: r.time,
  }];

  // Receipts saved before the fee line was named after its month have no `kind`, so fall back
  // to the wording those were written with.
  const isKind = (it: LineItem, kind: 'monthly' | 'admission') => it.kind
    ? it.kind === kind
    : (kind === 'monthly' ? /class fee$/i.test(it.desc) : /^admission fee$/i.test(it.desc));
  const amountFor = (kind: 'monthly' | 'admission', i: number): number | null => {
    const matches = r.items.filter(it => isKind(it, kind));
    const byName = people[i] && matches.find(it => it.sub === people[i].name);
    if (byName) return byName.amount;
    return people.length === 1 && matches[0] ? matches[0].amount : null;
  };

  const slot = (i: number): StudentSlot => {
    const p = people[i] ?? {};
    const picked = p.name ? findStudent(p.name) : null;
    return {
      name: p.name ?? '', id: p.id ?? '', category: p.category ?? '',
      day: p.day ?? '', time: p.time ?? '', cls: p.cls ?? '',
      // receipts from before sessions existed have none saved; take it from the roster then
      session: p.session || (i === 0 ? r.session : '') || picked?.session || '',
      monthly: amountFor('monthly', i), admission: amountFor('admission', i),
      picked,
    };
  };

  const extras: Extra[] = r.items.filter(i => !isKind(i, 'monthly') && !isKind(i, 'admission'))
    .map(i => ({ type: i.kind ?? 'other', label: i.desc, amount: i.amount }));
  return {
    id: r.id,
    number: r.number,
    date: r.date,
    two: people.length > 1,
    three: people.length > 2,
    s1: slot(0),
    s2: slot(1),
    s3: slot(2),
    month: MONTHS.includes(r.month) ? r.month : MONTHS[new Date().getMonth()],
    year: Number(r.year) || new Date().getFullYear(),
    extras: extras.length ? extras : [emptyExtra()],
    method: r.method || 'Bank Transfer',
    paidTo: r.paidTo ?? '',
    payer: r.payer ?? '',
    reference: r.reference ?? '',
    note: r.note ?? '',
  };
}
