/** Shapes shared with the Spring Boot API (lk.shalom.receipts.model). */

export interface ClassFee {
  name: string;
  fee: number;
}

export interface AppSettings {
  academyName: string;
  tagline: string;
  motto: string;
  address: string;
  phone: string;
  whatsapp: string;
  email: string;
  /** data-URI override; blank = logo.png from the app's public folder */
  logo: string;
  /** data-URI override; blank = signature.png from the app's public folder */
  signature: string;
  signName: string;
  signTitle: string;
  signStyle: 'typed' | 'image';
  prefix: string;
  numFormat: 'datetime' | 'compact' | 'epoch';
  currency: string;
  currencyWord: string;
  theme: 'monthly' | 'classic';
  classes: ClassFee[];
  admissionFee: number;
  footer: string;
  /** where money can go: the bank accounts and "Cash"; the first is the usual one */
  paidToOptions: string[];
  /** how money was paid: Bank Transfer, Cash, Cheque … */
  paymentMethods: string[];
  /** what a payment can be for; "monthly" and "admission" always come first */
  feeTypes: FeeType[];
  siblingDiscount: SiblingDiscount;
  /** extra details kept for each student */
  studentFields: StudentField[];
  /** put in front of local numbers for WhatsApp: "94" turns 0710407740 into 94710407740 */
  countryCode: string;
  /** sent with the receipt; {parent} {student} {period} {total} {number} {academy} are filled in */
  whatsappMessage: string;
}

export interface FeeType {
  /** stored on payments; "monthly" and "admission" are built in. Blank for a new one. */
  id: string;
  name: string;
  /** filled in when this type is picked */
  defaultAmount: number | null;
}

export interface SiblingDiscount {
  enabled: boolean;
  type: 'percent' | 'amount';
  value: number;
}

export type FieldType = 'text' | 'number' | 'date' | 'phone' | 'select';

export interface StudentField {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  /** also shown on the Students page rows */
  inList: boolean;
}

export interface Student {
  name: string;
  /** the academy number printed on the receipt (SAPA-1002) */
  id: string;
  /** the class: Kids, Junior, Youth, Adult or Online */
  category: string;
  day: string;
  time: string;
  /** the class session they sit in, e.g. "Andante"; blank when not yet placed */
  session: string;
  /** the fee charged: special fee, else the class fee. null = none set; 0 = free place */
  fee: number | null;
  /** a fee for this one student instead of the class fee */
  specialFee: number | null;
  active: boolean;
  parent: string;
  phone: string;
  note: string;
  country: string;
  /** students with the same family name are siblings */
  family: string;
  /** yyyy-MM-dd; blank when not known */
  dateOfBirth?: string;
  /** the extra fields from Settings, by key */
  custom: Record<string, string>;
}

export interface StudentInput {
  name: string;
  category: string;
  session: string;
  specialFee: number | null;
  active: boolean;
  parent: string;
  phone: string;
  note: string;
  country: string;
  family: string;
  custom: Record<string, string>;
  /** yyyy-MM-dd; left out = unchanged, blank = cleared */
  dateOfBirth?: string;
}

export interface Session {
  name: string;
  family: string;
  meaning: string;
  symbol: string;
  symbolStyle: string;
  category: string;
  day: string;
  time: string;
  /** the most students it should take; null = no limit set */
  max: number | null;
}

export type Billing = 'monthly' | 'term' | 'payg';

export interface FeeChange {
  /** the first month the new fee applies, "2027-01" */
  from: string;
  fee: number;
}

export interface Category {
  name: string;
  /** the class fee before any scheduled change; null = pay as you go */
  fee: number | null;
  billing: Billing;
  /** for term billing: months the fee is due, 1 = January */
  termMonths: number[];
  usesSessions: boolean;
  changes: FeeChange[];
}

/** A class as saved; `from` is its old name when renaming. */
export interface CategoryInput extends Category {
  from?: string;
}

export interface Roster {
  students: Student[];
  sessions: Session[];
  categories: Category[];
}

/* ---------------- payments ---------------- */

/** 'monthly', 'admission', 'other', or the id of a fee type from Settings */
export type PaymentKind = string;

export interface Payment {
  id: string;
  studentId: string | null;
  studentName: string;
  /** the fee month it pays for, "2026-11" */
  month: string;
  kind: PaymentKind;
  amount: number;
  paidTo: string;
  date: string;
  note: string | null;
  receiptId: string | null;
  receiptNumber: string | null;
}

export interface PaymentInput {
  studentId?: string;
  month?: string;
  kind?: PaymentKind;
  amount?: number | null;
  paidTo?: string;
  date?: string;
  note?: string;
}

export type PayStatus = 'Paid' | 'Partially Paid' | 'Pending' | 'Free place' | 'Inactive' | 'Not due';

export interface MonthRow {
  studentId: string;
  name: string;
  category: string;
  session: string;
  day: string;
  time: string;
  fee: number | null;
  paid: number;
  /** admission and other payments this month */
  extra: number;
  outstanding: number;
  status: PayStatus;
  active: boolean;
  feeOverridden: boolean;
  remark: string;
  parent: string;
  phone: string;
  country: string;
  payments: Payment[];
  /** sibling discount already taken off the fee */
  discount: number;
  family: string;
}

export interface PaidToTotal { name: string; amount: number; count: number; }

export interface MonthTotals {
  students: number;
  expected: number;
  collected: number;
  outstanding: number;
  completion: number;
  other: number;
  paid: number;
  partial: number;
  pending: number;
  free: number;
  inactive: number;
  /** term classes between terms */
  notDue: number;
  byPaidTo: PaidToTotal[];
}

export interface CategoryTotal {
  name: string;
  students: number;
  expected: number;
  collected: number;
  outstanding: number;
  paid: number;
  toPay: number;
  freePlaces: number | null;
  byPaidTo: Record<string, number>;
}

export interface SessionTotal {
  name: string;
  category: string;
  day: string;
  time: string;
  meaning: string;
  max: number | null;
  students: number;
  free: number | null;
  expected: number;
  collected: number;
}

export interface MonthView {
  month: string;
  label: string;
  started: boolean;
  newest: boolean;
  months: string[];
  rows: MonthRow[];
  totals: MonthTotals;
  categories: CategoryTotal[];
  sessions: SessionTotal[];
  unmatched: Payment[];
  paidToOptions: string[];
}

export interface Person {
  name: string;
  id: string;
  category: string;
  cls: string;
  day: string;
  time: string;
  session: string;
}

export interface LineItem {
  /** what the form reloads from: 'monthly', 'admission', a fee type id; absent for a free-text charge */
  kind?: string;
  desc: string;
  /** the child's name, when two students share the receipt */
  sub: string;
  amount: number;
}

export interface Receipt {
  id: string | null;
  number: string;
  date: string;
  people: Person[];
  student: string;
  studentId: string;
  category: string;
  cls: string;
  session: string;
  day: string;
  time: string;
  month: string;
  year: number;
  period: string;
  items: LineItem[];
  total: number;
  method: string;
  /** where the money went; recorded on the payment, not printed */
  paidTo: string;
  payer: string;
  reference: string;
  note: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** when it was sent to the parent on WhatsApp (set by the server) */
  sentAt?: string | null;
  /** the WhatsApp number it went to: "94710407740" */
  sentTo?: string | null;
}

export interface MonthTotal {
  period: string;
  receipts: number;
  total: number;
}
