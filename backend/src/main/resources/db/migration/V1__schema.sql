-- =====================================================================
--  Shalom Academy: the app's database.
--  Run once by Flyway when the app starts on an empty database. Later
--  changes go in new files (V2__..., V3__...), never by editing this one.
-- =====================================================================

-- things the app notes about itself, e.g. when the JSON files were imported
create table app_meta (
    key        text primary key,
    value      text,
    updated_at timestamptz not null default now()
);

-- academy details and the lists edited in Settings: one row, kept as a document
create table settings (
    id         int primary key default 1 check (id = 1),
    data       jsonb not null,
    updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
--  Classes, sessions and students
-- ---------------------------------------------------------------------

-- a class: Kids, Junior, Youth, Adult, Online …
create table categories (
    name          text primary key,
    position      int not null,
    fee           numeric(12, 2),                 -- null = pay as you go
    billing       text not null default 'monthly' check (billing in ('monthly', 'term', 'payg')),
    term_months   int[] not null default '{}',     -- term billing: the months it is due, 1 = January
    uses_sessions boolean not null default true
);

-- a class fee that changes from a given month
create table category_fee_changes (
    category   text not null references categories (name) on update cascade on delete cascade,
    from_month text not null check (from_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    fee        numeric(12, 2) not null check (fee >= 0),
    primary key (category, from_month)
);

-- a weekly class session: Andante, Forte …
create table sessions (
    name         text primary key,
    position     int not null,
    category     text references categories (name) on update cascade,
    day          text,
    time         text,
    max_students int check (max_students > 0),
    family       text,
    meaning      text,
    symbol       text,
    symbol_style text
);

create table students (
    id          text primary key,                  -- the academy number, SAPA-1002
    legacy_id   text,                              -- "s78", from the original spreadsheet
    row_key     text,
    position    int not null,
    name        text not null,
    category    text not null references categories (name) on update cascade,
    session     text references sessions (name) on update cascade on delete set null,
    class_day   text,
    class_time  text,
    fee         numeric(12, 2),                    -- what is charged now; null = no set fee
    special_fee numeric(12, 2),                    -- this student's own fee instead of the class fee
    active      boolean not null default true,
    parent      text,
    phone       text,
    note        text,
    country     text,
    family      text,                              -- the same family name = siblings
    custom      jsonb not null default '{}',       -- the extra fields set up in Settings
    extra       jsonb not null default '{}',       -- other details from the spreadsheet (age, song, result …)
    updated_at  timestamptz not null default now()
);
create index students_name_idx on students (lower(name));
create index students_session_idx on students (session);

-- ---------------------------------------------------------------------
--  Fee months, receipts and payments
-- ---------------------------------------------------------------------

-- a fee month, started once: who was expected to pay what
create table month_sheets (
    month      text primary key check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    created_at timestamptz
);

-- one student's fee for one month, copied in when the month starts. Not linked to students:
-- the month keeps its record even after a student is removed.
create table month_dues (
    month          text not null references month_sheets (month) on delete cascade,
    student_id     text not null,
    position       int not null,
    name           text,
    category       text,
    session        text,
    fee            numeric(12, 2),
    active         boolean not null default true,
    fee_overridden boolean not null default false,
    remark         text,
    discount       numeric(12, 2),
    not_billed     boolean,
    primary key (month, student_id)
);

create table receipts (
    id         text primary key,
    number     text,
    date       text,
    student    text,
    student_id text,
    category   text,
    cls        text,             -- the course: Guitar and Vocal
    session    text,
    day        text,
    time       text,
    month      text,             -- "November"
    year       int,
    period     text,             -- "November 2026"
    total      numeric(12, 2),
    method     text,
    paid_to    text,
    payer      text,
    reference  text,
    note       text,
    created_at timestamptz,
    updated_at timestamptz,
    sent_at    timestamptz,      -- sent to the parent on WhatsApp
    sent_to    text
);
create index receipts_number_idx on receipts (number);
create index receipts_created_idx on receipts (created_at desc);

-- the students on a receipt (two or three for brothers and sisters)
create table receipt_people (
    receipt_id text not null references receipts (id) on delete cascade,
    position   int not null,
    name       text,
    student_id text,
    category   text,
    cls        text,
    day        text,
    time       text,
    session    text,
    primary key (receipt_id, position)
);

-- the lines of a receipt's fee table
create table receipt_items (
    receipt_id  text not null references receipts (id) on delete cascade,
    position    int not null,
    kind        text,
    description text,
    sub         text,
    amount      numeric(12, 2),
    primary key (receipt_id, position)
);

-- money received for one student and one fee month
create table payments (
    id             text primary key,
    student_id     text,
    student_name   text,
    month          text not null,
    kind           text not null,
    amount         numeric(12, 2) not null,
    paid_to        text,
    date           text,
    note           text,
    receipt_id     text references receipts (id) on delete set null,
    receipt_number text,
    created_at     timestamptz
);
create index payments_month_idx on payments (month);
create index payments_student_idx on payments (student_id);
create index payments_receipt_idx on payments (receipt_id);

-- ---------------------------------------------------------------------
--  Student attendance and cover-up classes
-- ---------------------------------------------------------------------

create table attendance (
    date         date not null,
    session      text not null,
    student_id   text not null,
    student_name text,
    status       text check (status in ('P', 'L', 'A', 'M')),
    note         text,
    marked_by    text,
    marked_by_name text,
    marked_at    timestamptz,
    primary key (date, session, student_id)
);
create index attendance_student_idx on attendance (student_id);

create table makeups (
    id           text primary key,
    student_id   text not null,
    student_name text,
    from_session text,
    from_date    date,
    to_session   text,
    to_date      date,
    status       text not null check (status in ('booked', 'attended', 'missed')),
    note         text,
    booked_by    text,
    booked_by_name text,
    booked_at    timestamptz
);
create index makeups_student_idx on makeups (student_id);

-- ---------------------------------------------------------------------
--  Teachers: attendance and salary
-- ---------------------------------------------------------------------

create table teachers (
    id       text primary key,
    position int not null,
    name     text not null,
    phone    text,
    colour   text,
    active   boolean not null default true,
    pin_salt text,
    pin_hash text
);

-- pay rates and the academy's location for checking in: one row
create table teacher_settings (
    id                    int primary key default 1 check (id = 1),
    weekday_rate          numeric(12, 2) not null,
    weekend_rate          numeric(12, 2) not null,
    transport             numeric(12, 2) not null,
    transport_min_classes int not null,
    site_lat              double precision,
    site_lng              double precision,
    site_radius           int,
    early_minutes         int,
    late_minutes          int,
    done_minutes          int
);

-- the weekly timetable
create table timetable_slots (
    id       text primary key,
    position int not null,
    day      text not null,
    start    text not null,
    minutes  int,
    category text,
    label    text
);

create table holidays (
    date      date not null,
    name      text not null,
    position  int not null,
    class_off boolean not null default false,
    primary key (date, name)
);

-- a teacher at a class: checked in from their phone, or ticked by the office
create table teacher_attendance (
    date          date not null,
    slot_id       text not null,
    teacher_id    text not null references teachers (id) on update cascade,
    method        text,
    at            timestamptz,
    lat           double precision,
    lng           double precision,
    accuracy      double precision,
    distance      double precision,
    done_at       timestamptz,
    note          text,
    done_distance double precision,
    primary key (date, slot_id, teacher_id)
);

create table salary_adjustments (
    period     text not null,     -- the pay period, by the month it ends in
    teacher_id text not null references teachers (id) on update cascade,
    position   int not null,
    amount     numeric(12, 2) not null,
    note       text,
    primary key (period, teacher_id)
);

create table salary_payouts (
    period     text not null,
    teacher_id text not null references teachers (id) on update cascade,
    position   int not null,
    amount     numeric(12, 2),
    paid_at    timestamptz,
    primary key (period, teacher_id)
);

-- ---------------------------------------------------------------------
--  Online registration
-- ---------------------------------------------------------------------

create table registration_form (
    id             int primary key default 1 check (id = 1),
    open           boolean not null default true,
    token          text not null,
    title          text,
    intro          text,
    closed_message text,
    thanks         text
);

create table registrations (
    id              text primary key,
    number          text not null unique,          -- REG-2026-0001
    submitted_at    timestamptz,
    submission_key  text unique,
    child_name      text not null,
    preferred_name  text,
    date_of_birth   date,
    gender          text,
    school          text,
    grade           text,
    interest        text,
    preferred_class text,
    preferred_days  text[] not null default '{}',
    experience      text,
    parent_name     text not null,
    relation        text,
    phone           text not null,
    whatsapp        text,
    email           text,
    address         text,
    emergency_name  text,
    emergency_phone text,
    medical         text,
    how_heard       text,
    message         text,
    photo_consent   boolean,
    agreed          boolean,
    admin_note      text,
    student_id      text references students (id) on update cascade on delete set null,   -- once placed in a class
    placed_at       timestamptz,
    updated_at      timestamptz
);
create index registrations_child_idx on registrations (lower(child_name));
