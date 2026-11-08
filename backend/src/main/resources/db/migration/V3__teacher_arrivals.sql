-- When each teacher first opened the app at the academy that day: their reported time.
create table teacher_arrivals (
    date       date not null,
    teacher_id text not null references teachers (id) on update cascade on delete cascade,
    at         timestamptz not null,
    lat        double precision,
    lng        double precision,
    accuracy   double precision,
    distance   double precision,
    primary key (date, teacher_id)
);
