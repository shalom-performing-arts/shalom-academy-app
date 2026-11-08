package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.TeacherBook;
import lk.shalom.receipts.model.TeacherBook.Adjustment;
import lk.shalom.receipts.model.TeacherBook.Arrival;
import lk.shalom.receipts.model.TeacherBook.Holiday;
import lk.shalom.receipts.model.TeacherBook.Mark;
import lk.shalom.receipts.model.TeacherBook.Payout;
import lk.shalom.receipts.model.TeacherBook.Rates;
import lk.shalom.receipts.model.TeacherBook.Site;
import lk.shalom.receipts.model.TeacherBook.Slot;
import lk.shalom.receipts.model.TeacherBook.Teacher;
import lk.shalom.receipts.repository.TeacherRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Objects;
import java.util.function.UnaryOperator;

/**
 * Teachers and everything about their classes and pay: teachers, teacher_settings (rates and the
 * check-in location), timetable_slots, holidays, teacher_attendance, salary_adjustments and
 * salary_payouts. Held in memory; each change writes only the rows it touched.
 */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgTeacherRepository implements TeacherRepository {

    private final Db db;
    private TeacherBook current;

    public PgTeacherRepository(Db db) {
        this.db = db;
    }

    @Override
    public synchronized TeacherBook get() {
        if (current == null) current = load();
        return current;
    }

    @Override
    public synchronized TeacherBook update(UnaryOperator<TeacherBook> change) {
        TeacherBook now = get();
        TeacherBook before = new TeacherBook(List.copyOf(now.teachers()), now.rates(), List.copyOf(now.schedule()),
                List.copyOf(now.holidays()), now.site(), List.copyOf(now.attendance()), List.copyOf(now.adjustments()),
                List.copyOf(now.payouts()), List.copyOf(now.arrivals()));
        TeacherBook after = change.apply(now).clean();
        try {
            db.inTx(() -> write(before, after));
        } catch (RuntimeException e) {
            current = null;
            throw e;
        }
        current = after;
        return after;
    }

    /* ---------------- reading ---------------- */

    private TeacherBook load() {
        TeacherBook b = TeacherBook.empty();
        b.teachers().addAll(db.jdbc.query("select * from teachers order by position", (rs, n) -> new Teacher(
                rs.getString("id"), rs.getString("name"), rs.getString("phone"), rs.getString("colour"),
                rs.getBoolean("active"), rs.getString("pin_salt"), rs.getString("pin_hash"))));
        Rates rates = Rates.defaults();
        Site site = Site.defaults();
        List<Object[]> settings = db.jdbc.query("select * from teacher_settings where id = 1", (rs, n) -> new Object[]{
                new Rates(Db.money(rs, "weekday_rate"), Db.money(rs, "weekend_rate"), Db.money(rs, "transport"),
                        Db.integer(rs, "transport_min_classes")),
                new Site(Db.dbl(rs, "site_lat"), Db.dbl(rs, "site_lng"), Db.integer(rs, "site_radius"),
                        Db.integer(rs, "early_minutes"), Db.integer(rs, "late_minutes"), Db.integer(rs, "done_minutes"))});
        if (!settings.isEmpty()) {
            rates = (Rates) settings.getFirst()[0];
            site = (Site) settings.getFirst()[1];
        }
        b.schedule().addAll(db.jdbc.query("select * from timetable_slots order by position", (rs, n) -> new Slot(
                rs.getString("id"), rs.getString("day"), rs.getString("start"), Db.integer(rs, "minutes"),
                rs.getString("category"), rs.getString("label"))));
        b.holidays().addAll(db.jdbc.query("select date::text as d, name, class_off from holidays order by position",
                (rs, n) -> new Holiday(rs.getString("d"), rs.getString("name"), rs.getBoolean("class_off"))));
        b.attendance().addAll(db.jdbc.query("""
                select date::text as d, slot_id, teacher_id, method, at, lat, lng, accuracy, distance, done_at, note, done_distance
                from teacher_attendance order by date, at nulls first""", (rs, n) -> new Mark(
                rs.getString("d"), rs.getString("slot_id"), rs.getString("teacher_id"), rs.getString("method"),
                Db.instant(rs, "at"), Db.dbl(rs, "lat"), Db.dbl(rs, "lng"), Db.dbl(rs, "accuracy"), Db.dbl(rs, "distance"),
                Db.instant(rs, "done_at"), rs.getString("note"), Db.dbl(rs, "done_distance"))));
        b.adjustments().addAll(db.jdbc.query("select * from salary_adjustments order by position", (rs, n) ->
                new Adjustment(rs.getString("period"), rs.getString("teacher_id"), Db.money(rs, "amount"), rs.getString("note"))));
        b.payouts().addAll(db.jdbc.query("select * from salary_payouts order by position", (rs, n) ->
                new Payout(rs.getString("period"), rs.getString("teacher_id"), Db.money(rs, "amount"), Db.instant(rs, "paid_at"))));
        b.arrivals().addAll(db.jdbc.query("""
                select date::text as d, teacher_id, at, lat, lng, accuracy, distance from teacher_arrivals order by date, at""",
                (rs, n) -> new Arrival(rs.getString("d"), rs.getString("teacher_id"), Db.instant(rs, "at"), Db.dbl(rs, "lat"),
                        Db.dbl(rs, "lng"), Db.dbl(rs, "accuracy"), Db.dbl(rs, "distance"))));
        return new TeacherBook(b.teachers(), rates, b.schedule(), b.holidays(), site, b.attendance(), b.adjustments(),
                b.payouts(), b.arrivals()).clean();
    }

    /* ---------------- writing ---------------- */

    private record MarkKey(String date, String slotId, String teacherId) {}

    private record PeriodKey(String period, String teacherId) {}

    private record HolidayKey(String date, String name) {}

    private record ArrivalKey(String date, String teacherId) {}

    /**
     * Rows that depend on a teacher are removed before the teacher, and written after them, so a
     * teacher whose id changes takes their attendance and pay along.
     */
    private void write(TeacherBook before, TeacherBook after) {
        Db.Changes<Teacher, String> t = Db.diff(before.teachers(), after.teachers(), Teacher::id, true);
        Db.Changes<Mark, MarkKey> m = Db.diff(before.attendance(), after.attendance(),
                x -> new MarkKey(x.date(), x.slotId(), x.teacherId()), false);
        Db.Changes<Adjustment, PeriodKey> a = Db.diff(before.adjustments(), after.adjustments(),
                x -> new PeriodKey(x.period(), x.teacherId()), true);
        Db.Changes<Payout, PeriodKey> p = Db.diff(before.payouts(), after.payouts(),
                x -> new PeriodKey(x.period(), x.teacherId()), true);
        Db.Changes<Arrival, ArrivalKey> v = Db.diff(before.arrivals(), after.arrivals(),
                x -> new ArrivalKey(x.date(), x.teacherId()), false);

        // 1. what leaves, children first
        for (MarkKey k : m.deletes()) {
            db.jdbc.update("delete from teacher_attendance where date = ?::date and slot_id = ? and teacher_id = ?",
                    k.date(), k.slotId(), k.teacherId());
        }
        for (PeriodKey k : a.deletes()) db.jdbc.update("delete from salary_adjustments where period = ? and teacher_id = ?", k.period(), k.teacherId());
        for (PeriodKey k : p.deletes()) db.jdbc.update("delete from salary_payouts where period = ? and teacher_id = ?", k.period(), k.teacherId());
        for (ArrivalKey k : v.deletes()) db.jdbc.update("delete from teacher_arrivals where date = ?::date and teacher_id = ?", k.date(), k.teacherId());

        // 2. teachers, then what hangs off them
        for (Db.At<Teacher> at : t.upserts()) {
            Teacher x = at.item();
            db.jdbc.update("""
                    insert into teachers (id, position, name, phone, colour, active, pin_salt, pin_hash)
                    values (?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (id) do update set position = excluded.position, name = excluded.name, phone = excluded.phone,
                        colour = excluded.colour, active = excluded.active, pin_salt = excluded.pin_salt, pin_hash = excluded.pin_hash""",
                    x.id(), at.position(), x.name(), x.phone(), x.colour(), x.isActive(), x.pinSalt(), x.pinHash());
        }
        for (Db.At<Mark> at : m.upserts()) {
            Mark x = at.item();
            db.jdbc.update("""
                    insert into teacher_attendance (date, slot_id, teacher_id, method, at, lat, lng, accuracy, distance,
                                                    done_at, note, done_distance)
                    values (?::date, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (date, slot_id, teacher_id) do update set method = excluded.method, at = excluded.at,
                        lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy, distance = excluded.distance,
                        done_at = excluded.done_at, note = excluded.note, done_distance = excluded.done_distance""",
                    x.date(), x.slotId(), x.teacherId(), x.method(), Db.ts(x.at()), x.lat(), x.lng(), x.accuracy(),
                    x.distance(), Db.ts(x.doneAt()), x.note(), x.doneDistance());
        }
        for (Db.At<Adjustment> at : a.upserts()) {
            Adjustment x = at.item();
            db.jdbc.update("""
                    insert into salary_adjustments (period, teacher_id, position, amount, note) values (?, ?, ?, ?, ?)
                    on conflict (period, teacher_id) do update set position = excluded.position, amount = excluded.amount,
                        note = excluded.note""", x.period(), x.teacherId(), at.position(), x.amount(), x.note());
        }
        for (Db.At<Payout> at : p.upserts()) {
            Payout x = at.item();
            db.jdbc.update("""
                    insert into salary_payouts (period, teacher_id, position, amount, paid_at) values (?, ?, ?, ?, ?)
                    on conflict (period, teacher_id) do update set position = excluded.position, amount = excluded.amount,
                        paid_at = excluded.paid_at""", x.period(), x.teacherId(), at.position(), x.amount(), Db.ts(x.paidAt()));
        }

        for (Db.At<Arrival> at : v.upserts()) {
            Arrival x = at.item();
            db.jdbc.update("""
                    insert into teacher_arrivals (date, teacher_id, at, lat, lng, accuracy, distance) values (?::date, ?, ?, ?, ?, ?, ?)
                    on conflict (date, teacher_id) do update set at = excluded.at, lat = excluded.lat, lng = excluded.lng,
                        accuracy = excluded.accuracy, distance = excluded.distance""",
                    x.date(), x.teacherId(), Db.ts(x.at()), x.lat(), x.lng(), x.accuracy(), x.distance());
        }

        // 3. teachers who left
        for (String id : t.deletes()) db.jdbc.update("delete from teachers where id = ?", id);

        // 4. the timetable, holidays, rates and location
        Db.Changes<Slot, String> s = Db.diff(before.schedule(), after.schedule(), Slot::id, true);
        for (String id : s.deletes()) db.jdbc.update("delete from timetable_slots where id = ?", id);
        for (Db.At<Slot> at : s.upserts()) {
            Slot x = at.item();
            db.jdbc.update("""
                    insert into timetable_slots (id, position, day, start, minutes, category, label) values (?, ?, ?, ?, ?, ?, ?)
                    on conflict (id) do update set position = excluded.position, day = excluded.day, start = excluded.start,
                        minutes = excluded.minutes, category = excluded.category, label = excluded.label""",
                    x.id(), at.position(), x.day(), x.start(), x.minutes(), x.category(), x.label());
        }
        Db.Changes<Holiday, HolidayKey> h = Db.diff(before.holidays(), after.holidays(), x -> new HolidayKey(x.date(), x.name()), true);
        for (HolidayKey k : h.deletes()) db.jdbc.update("delete from holidays where date = ?::date and name = ?", k.date(), k.name());
        for (Db.At<Holiday> at : h.upserts()) {
            Holiday x = at.item();
            db.jdbc.update("""
                    insert into holidays (date, name, position, class_off) values (?::date, ?, ?, ?)
                    on conflict (date, name) do update set position = excluded.position, class_off = excluded.class_off""",
                    x.date(), x.name(), at.position(), x.off());
        }
        boolean settingsMissing = db.count("teacher_settings") == 0;
        if (settingsMissing || !Objects.equals(before.rates(), after.rates()) || !Objects.equals(before.site(), after.site())) {
            Rates r = after.rates();
            Site st = after.site();
            db.jdbc.update("""
                    insert into teacher_settings (id, weekday_rate, weekend_rate, transport, transport_min_classes,
                                                  site_lat, site_lng, site_radius, early_minutes, late_minutes, done_minutes)
                    values (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (id) do update set weekday_rate = excluded.weekday_rate, weekend_rate = excluded.weekend_rate,
                        transport = excluded.transport, transport_min_classes = excluded.transport_min_classes,
                        site_lat = excluded.site_lat, site_lng = excluded.site_lng, site_radius = excluded.site_radius,
                        early_minutes = excluded.early_minutes, late_minutes = excluded.late_minutes,
                        done_minutes = excluded.done_minutes""",
                    r.weekday(), r.weekend(), r.transport(), r.minClasses(), st.lat(), st.lng(), st.radiusM(), st.early(),
                    st.late(), st.done());
        }
    }

}
