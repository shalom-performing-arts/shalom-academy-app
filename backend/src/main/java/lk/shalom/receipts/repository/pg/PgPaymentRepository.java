package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.Payment;
import lk.shalom.receipts.repository.PaymentRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/** Payments, in the payments table. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgPaymentRepository implements PaymentRepository {

    private static final String COLS = "id, student_id, student_name, month, kind, amount, paid_to, date, note, "
            + "receipt_id, receipt_number, created_at";
    private static final String ORDER = " order by created_at nulls first, id";

    private static final RowMapper<Payment> ROW = (rs, n) -> new Payment(
            rs.getString("id"), rs.getString("student_id"), rs.getString("student_name"), rs.getString("month"),
            rs.getString("kind"), Db.money(rs, "amount"), rs.getString("paid_to"), rs.getString("date"),
            rs.getString("note"), rs.getString("receipt_id"), rs.getString("receipt_number"), Db.instant(rs, "created_at"));

    private final Db db;

    public PgPaymentRepository(Db db) {
        this.db = db;
    }

    @Override
    public List<Payment> findAll() {
        return db.jdbc.query("select " + COLS + " from payments" + ORDER, ROW);
    }

    @Override
    public List<Payment> findByMonth(String month) {
        return db.jdbc.query("select " + COLS + " from payments where month = ?" + ORDER, ROW, month);
    }

    @Override
    public List<Payment> findByReceipt(String receiptId) {
        if (receiptId == null) return List.of();
        return db.jdbc.query("select " + COLS + " from payments where receipt_id = ?" + ORDER, ROW, receiptId);
    }

    @Override
    public Optional<Payment> findById(String id) {
        return db.jdbc.query("select " + COLS + " from payments where id = ?", ROW, id).stream().findFirst();
    }

    @Override
    public synchronized Payment save(Payment p) {
        upsert(p);
        return p;
    }

    @Override
    public synchronized boolean deleteById(String id) {
        return db.jdbc.update("delete from payments where id = ?", id) > 0;
    }

    /** Keeps the rows that stay as they are; only new, changed and removed payments are written. */
    @Override
    public synchronized void replaceAll(List<Payment> all) {
        db.inTx(() -> {
            Set<String> keep = all.stream().map(Payment::id).collect(Collectors.toSet());
            for (Payment old : findAll()) if (!keep.contains(old.id())) deleteById(old.id());
            all.forEach(this::upsert);
        });
    }

    private void upsert(Payment p) {
        db.jdbc.update("insert into payments (" + COLS + ") values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
                        + "on conflict (id) do update set student_id = excluded.student_id, student_name = excluded.student_name, "
                        + "month = excluded.month, kind = excluded.kind, amount = excluded.amount, paid_to = excluded.paid_to, "
                        + "date = excluded.date, note = excluded.note, receipt_id = excluded.receipt_id, "
                        + "receipt_number = excluded.receipt_number, created_at = excluded.created_at",
                p.id(), p.studentId(), p.studentName(), p.month(), p.kind(), p.amount(), p.paidTo(), p.date(), p.note(),
                p.receiptId(), p.receiptNumber(), Db.ts(p.createdAt()));
    }
}
