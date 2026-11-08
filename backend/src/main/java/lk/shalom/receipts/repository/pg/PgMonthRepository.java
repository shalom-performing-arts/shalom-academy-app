package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.MonthSheet;
import lk.shalom.receipts.model.MonthSheet.Due;
import lk.shalom.receipts.repository.MonthRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/** Fee months: month_sheets, and each student's fee for the month in month_dues. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgMonthRepository implements MonthRepository {

    private final Db db;

    public PgMonthRepository(Db db) {
        this.db = db;
    }

    @Override
    public List<String> months() {
        return db.jdbc.queryForList("select month from month_sheets order by month", String.class);
    }

    @Override
    public Optional<MonthSheet> find(String month) {
        List<java.time.Instant> created = db.jdbc.query("select created_at from month_sheets where month = ?",
                (rs, n) -> Db.instant(rs, "created_at"), month);
        if (created.isEmpty()) return Optional.empty();
        return Optional.of(new MonthSheet(month, created.getFirst(), dues(month)));
    }

    @Override
    public synchronized MonthSheet save(MonthSheet sheet) {
        db.inTx(() -> write(sheet));
        return sheet;
    }

    @Override
    public List<MonthSheet> findAll() {
        List<MonthSheet> out = new ArrayList<>();
        for (String m : months()) find(m).ifPresent(out::add);
        return out;
    }

    @Override
    public synchronized void replaceAll(List<MonthSheet> sheets) {
        db.inTx(() -> {
            db.jdbc.update("delete from month_sheets");
            sheets.forEach(this::write);
        });
    }

    private List<Due> dues(String month) {
        return new ArrayList<>(db.jdbc.query("""
                select student_id, name, category, session, fee, active, fee_overridden, remark, discount, not_billed
                from month_dues where month = ? order by position""", (rs, n) -> new Due(
                rs.getString("student_id"), rs.getString("name"), rs.getString("category"), rs.getString("session"),
                Db.money(rs, "fee"), rs.getBoolean("active"), rs.getBoolean("fee_overridden"), rs.getString("remark"),
                Db.money(rs, "discount"), Db.bool(rs, "not_billed")), month));
    }

    private void write(MonthSheet sheet) {
        db.jdbc.update("""
                insert into month_sheets (month, created_at) values (?, ?)
                on conflict (month) do update set created_at = excluded.created_at""", sheet.month(), Db.ts(sheet.createdAt()));
        db.jdbc.update("delete from month_dues where month = ?", sheet.month());
        List<Object[]> rows = new ArrayList<>();
        List<Due> dues = sheet.dues() == null ? List.of() : sheet.dues();
        for (int i = 0; i < dues.size(); i++) {
            Due d = dues.get(i);
            rows.add(new Object[]{sheet.month(), d.studentId(), i, d.name(), d.category(), d.session(), d.fee(), d.active(),
                    d.feeOverridden(), d.remark(), d.discount(), d.notBilled()});
        }
        if (!rows.isEmpty()) {
            db.jdbc.batchUpdate("""
                    insert into month_dues (month, student_id, position, name, category, session, fee, active,
                                            fee_overridden, remark, discount, not_billed)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", rows);
        }
    }
}
