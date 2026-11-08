package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Receipt.LineItem;
import lk.shalom.receipts.model.Receipt.Person;
import lk.shalom.receipts.repository.ReceiptRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/** Receipts: the receipts table, with the students on each (receipt_people) and its lines (receipt_items). */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgReceiptRepository implements ReceiptRepository {

    private static final String COLS = "id, number, date, student, student_id, category, cls, session, day, time, month, "
            + "year, period, total, method, paid_to, payer, reference, note, created_at, updated_at, sent_at, sent_to";

    private final Db db;

    public PgReceiptRepository(Db db) {
        this.db = db;
    }

    @Override
    public List<Receipt> findAll() {
        return load("", List.of());
    }

    @Override
    public Optional<Receipt> findById(String id) {
        return load(" where id = ?", List.of(id)).stream().findFirst();
    }

    @Override
    public Optional<Receipt> findByNumber(String number) {
        return load(" where number = ?", List.of(number)).stream().findFirst();
    }

    @Override
    public synchronized Receipt save(Receipt r) {
        db.inTx(() -> write(r));
        return r;
    }

    @Override
    public synchronized boolean deleteById(String id) {
        return db.jdbc.update("delete from receipts where id = ?", id) > 0;
    }

    @Override
    public synchronized int deleteAll() {
        return db.jdbc.update("delete from receipts");
    }

    /** Receipts that stay are rewritten in place, so payments keep their link to them. */
    @Override
    public synchronized void replaceAll(List<Receipt> all) {
        db.inTx(() -> {
            Set<String> keep = all.stream().map(Receipt::id).collect(Collectors.toSet());
            for (String id : db.jdbc.queryForList("select id from receipts", String.class)) {
                if (!keep.contains(id)) deleteById(id);
            }
            all.forEach(this::write);
        });
    }

    /* ---------------- reading ---------------- */

    private List<Receipt> load(String where, List<Object> args) {
        List<Receipt> heads = db.jdbc.query("select " + COLS + " from receipts" + where
                + " order by created_at desc nulls last, number desc nulls last", (rs, n) -> new Receipt(
                rs.getString("id"), rs.getString("number"), rs.getString("date"), null, rs.getString("student"),
                rs.getString("student_id"), rs.getString("category"), rs.getString("cls"), rs.getString("session"),
                rs.getString("day"), rs.getString("time"), rs.getString("month"), Db.integer(rs, "year"),
                rs.getString("period"), null, Db.money(rs, "total"), rs.getString("method"), rs.getString("paid_to"),
                rs.getString("payer"), rs.getString("reference"), rs.getString("note"), Db.instant(rs, "created_at"),
                Db.instant(rs, "updated_at"), Db.instant(rs, "sent_at"), rs.getString("sent_to")), args.toArray());
        if (heads.isEmpty()) return heads;

        String only = where.isEmpty() ? "" : " where receipt_id in (select id from receipts" + where + ")";
        Map<String, List<Person>> people = new HashMap<>();
        db.jdbc.query("select * from receipt_people" + only + " order by receipt_id, position", rs -> {
            people.computeIfAbsent(rs.getString("receipt_id"), k -> new ArrayList<>()).add(new Person(
                    rs.getString("name"), rs.getString("student_id"), rs.getString("category"), rs.getString("cls"),
                    rs.getString("day"), rs.getString("time"), rs.getString("session")));
        }, args.toArray());
        Map<String, List<LineItem>> items = new HashMap<>();
        db.jdbc.query("select * from receipt_items" + only + " order by receipt_id, position", rs -> {
            items.computeIfAbsent(rs.getString("receipt_id"), k -> new ArrayList<>()).add(new LineItem(
                    rs.getString("kind"), rs.getString("description"), rs.getString("sub"), Db.money(rs, "amount")));
        }, args.toArray());

        List<Receipt> out = new ArrayList<>();
        for (Receipt r : heads) {
            out.add(new Receipt(r.id(), r.number(), r.date(), people.get(r.id()), r.student(),
                    r.studentId(), r.category(), r.cls(), r.session(), r.day(), r.time(), r.month(), r.year(), r.period(),
                    items.get(r.id()), r.total(), r.method(), r.paidTo(), r.payer(),
                    r.reference(), r.note(), r.createdAt(), r.updatedAt(), r.sentAt(), r.sentTo()));
        }
        return out;
    }

    /* ---------------- writing ---------------- */

    private void write(Receipt r) {
        db.jdbc.update("insert into receipts (" + COLS + ") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                        + "on conflict (id) do update set number = excluded.number, date = excluded.date, student = excluded.student, "
                        + "student_id = excluded.student_id, category = excluded.category, cls = excluded.cls, session = excluded.session, "
                        + "day = excluded.day, time = excluded.time, month = excluded.month, year = excluded.year, period = excluded.period, "
                        + "total = excluded.total, method = excluded.method, paid_to = excluded.paid_to, payer = excluded.payer, "
                        + "reference = excluded.reference, note = excluded.note, created_at = excluded.created_at, "
                        + "updated_at = excluded.updated_at, sent_at = excluded.sent_at, sent_to = excluded.sent_to",
                r.id(), r.number(), r.date(), r.student(), r.studentId(), r.category(), r.cls(), r.session(), r.day(), r.time(),
                r.month(), r.year(), r.period(), r.total(), r.method(), r.paidTo(), r.payer(), r.reference(), r.note(),
                Db.ts(r.createdAt()), Db.ts(r.updatedAt()), Db.ts(r.sentAt()), r.sentTo());
        db.jdbc.update("delete from receipt_people where receipt_id = ?", r.id());
        db.jdbc.update("delete from receipt_items where receipt_id = ?", r.id());
        List<Person> people = r.people() == null ? List.of() : r.people();
        for (int i = 0; i < people.size(); i++) {
            Person p = people.get(i);
            if (p == null) continue;
            db.jdbc.update("insert into receipt_people (receipt_id, position, name, student_id, category, cls, day, time, session) "
                    + "values (?, ?, ?, ?, ?, ?, ?, ?, ?)", r.id(), i, p.name(), p.id(), p.category(), p.cls(), p.day(), p.time(), p.session());
        }
        List<LineItem> items = r.items() == null ? List.of() : r.items();
        for (int i = 0; i < items.size(); i++) {
            LineItem x = items.get(i);
            if (x == null) continue;
            db.jdbc.update("insert into receipt_items (receipt_id, position, kind, description, sub, amount) values (?, ?, ?, ?, ?, ?)",
                    r.id(), i, x.kind(), x.desc(), x.sub(), x.amount());
        }
    }
}
