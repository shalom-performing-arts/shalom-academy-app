-- One class on one date held on another day and time instead (rain, a holiday, a clash).
create table class_moves (
    id         text primary key,
    session    text not null,
    category   text,
    slot_id    text,
    from_date  date not null,
    to_date    date not null,
    start      text not null,
    minutes    integer,
    note       text,
    created_at timestamptz
);
