package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.RollBook;
import lk.shalom.receipts.model.RollBook.Entry;
import lk.shalom.receipts.model.RollBook.Makeup;
import lk.shalom.receipts.repository.RollRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.function.UnaryOperator;

/**
 * Student attendance (the attendance table, one row per student per class day) and cover-up
 * classes (makeups). Held in memory for the registers; each change writes only the rows it touched.
 */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgRollRepository implements RollRepository {

    private final Db db;
    private RollBook current;

    public PgRollRepository(Db db) {
        this.db = db;
    }

    @Override
    public synchronized RollBook get() {
        if (current == null) current = load();
        return current;
    }

    @Override
    public synchronized RollBook update(UnaryOperator<RollBook> change) {
        RollBook now = get();
        RollBook before = new RollBook(List.copyOf(now.entries()), List.copyOf(now.makeups()));
        RollBook after = change.apply(now).clean();
        try {
            db.inTx(() -> write(before, after));
        } catch (RuntimeException e) {
            current = null;   // read back what the database holds
            throw e;
        }
        current = after;
        return after;
    }

    private RollBook load() {
        List<Entry> entries = db.jdbc.query("""
                select date::text as date, session, student_id, student_name, status, note, marked_by, marked_by_name, marked_at
                from attendance order by date, session, marked_at nulls first""", (rs, n) -> new Entry(
                rs.getString("date"), rs.getString("session"), rs.getString("student_id"), rs.getString("student_name"),
                rs.getString("status"), rs.getString("note"), rs.getString("marked_by"), rs.getString("marked_by_name"),
                Db.instant(rs, "marked_at")));
        List<Makeup> makeups = db.jdbc.query("""
                select id, student_id, student_name, from_session, from_date::text as from_date, to_session,
                       to_date::text as to_date, status, note, booked_by, booked_by_name, booked_at
                from makeups order by booked_at nulls first, id""", (rs, n) -> new Makeup(
                rs.getString("id"), rs.getString("student_id"), rs.getString("student_name"), rs.getString("from_session"),
                rs.getString("from_date"), rs.getString("to_session"), rs.getString("to_date"), rs.getString("status"),
                rs.getString("note"), rs.getString("booked_by"), rs.getString("booked_by_name"), Db.instant(rs, "booked_at")));
        return new RollBook(new ArrayList<>(entries), new ArrayList<>(makeups)).clean();
    }

    private record EntryKey(String date, String session, String studentId) {}

    private void write(RollBook before, RollBook after) {
        Db.Changes<Entry, EntryKey> e = Db.diff(before.entries(), after.entries(),
                x -> new EntryKey(x.date(), x.session(), x.studentId()), false);
        for (EntryKey k : e.deletes()) {
            db.jdbc.update("delete from attendance where date = ?::date and session = ? and student_id = ?",
                    k.date(), k.session(), k.studentId());
        }
        for (Db.At<Entry> at : e.upserts()) {
            Entry x = at.item();
            db.jdbc.update("""
                    insert into attendance (date, session, student_id, student_name, status, note, marked_by, marked_by_name, marked_at)
                    values (?::date, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (date, session, student_id) do update set student_name = excluded.student_name,
                        status = excluded.status, note = excluded.note, marked_by = excluded.marked_by,
                        marked_by_name = excluded.marked_by_name, marked_at = excluded.marked_at""",
                    x.date(), x.session(), x.studentId(), x.studentName(), x.status(), x.note(), x.by(), x.byName(), Db.ts(x.at()));
        }

        Db.Changes<Makeup, String> m = Db.diff(before.makeups(), after.makeups(), Makeup::id, false);
        for (String id : m.deletes()) db.jdbc.update("delete from makeups where id = ?", id);
        for (Db.At<Makeup> at : m.upserts()) {
            Makeup x = at.item();
            db.jdbc.update("""
                    insert into makeups (id, student_id, student_name, from_session, from_date, to_session, to_date, status,
                                         note, booked_by, booked_by_name, booked_at)
                    values (?, ?, ?, ?, ?::date, ?, ?::date, ?, ?, ?, ?, ?)
                    on conflict (id) do update set student_id = excluded.student_id, student_name = excluded.student_name,
                        from_session = excluded.from_session, from_date = excluded.from_date, to_session = excluded.to_session,
                        to_date = excluded.to_date, status = excluded.status, note = excluded.note,
                        booked_by = excluded.booked_by, booked_by_name = excluded.booked_by_name, booked_at = excluded.booked_at""",
                    x.id(), x.studentId(), x.studentName(), x.fromSession(), x.fromDate(), x.toSession(), x.toDate(), x.status(),
                    x.note(), x.by(), x.byName(), Db.ts(x.at()));
        }
    }
}
