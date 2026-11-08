package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.repository.AbstractRosterRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Students, sessions and classes in the students, sessions, categories and category_fee_changes
 * tables. The roster logic itself (fees, renames, numbering) is shared with the JSON version in
 * {@link AbstractRosterRepository}; this class only reads and writes the tables.
 *
 * <p>Details the app does not manage (age, song, adjudication result …) are kept in the
 * {@code extra} column, so nothing from the original spreadsheet is lost.
 */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgRosterRepository extends AbstractRosterRepository {

    /** the student fields that have a column of their own */
    private static final Set<String> COLUMNS = Set.of("id", "key", "sapaId", "name", "category", "className", "classDay",
            "classTime", "fee", "specialFee", "active", "parent", "phone", "note", "country", "family", "custom", "dateOfBirth");

    private final Db db;

    public PgRosterRepository(Db db) {
        this.db = db;
    }

    /* ---------------- tables → the roster ---------------- */

    @Override
    protected Map<String, Object> readRaw() {
        Map<String, List<Map<String, Object>>> changes = new LinkedHashMap<>();
        db.jdbc.query("select category, from_month, fee from category_fee_changes order by category, from_month", rs -> {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("from", rs.getString("from_month"));
            c.put("fee", Db.money(rs, "fee"));
            changes.computeIfAbsent(rs.getString("category"), k -> new ArrayList<>()).add(c);
        });
        List<Map<String, Object>> categories = db.jdbc.query(
                "select name, fee, billing, term_months, uses_sessions from categories order by position", (rs, n) -> {
                    Map<String, Object> c = new LinkedHashMap<>();
                    String name = rs.getString("name");
                    c.put("name", name);
                    c.put("fee", Db.money(rs, "fee"));
                    c.put("billing", rs.getString("billing"));
                    List<Integer> term = Db.ints(rs, "term_months");
                    if (!term.isEmpty()) c.put("termMonths", term);
                    c.put("usesSessions", rs.getBoolean("uses_sessions"));
                    if (changes.containsKey(name)) c.put("changes", changes.get(name));
                    return c;
                });
        List<Map<String, Object>> classes = db.jdbc.query("""
                select name, family, meaning, symbol, symbol_style, category, day, time, max_students
                from sessions order by position""", (rs, n) -> {
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("name", rs.getString("name"));
            put(c, "family", rs.getString("family"));
            put(c, "meaning", rs.getString("meaning"));
            put(c, "symbol", rs.getString("symbol"));
            put(c, "symbolStyle", rs.getString("symbol_style"));
            put(c, "category", rs.getString("category"));
            put(c, "day", rs.getString("day"));
            put(c, "time", rs.getString("time"));
            put(c, "max", Db.integer(rs, "max_students"));
            return c;
        });
        List<Map<String, Object>> students = db.jdbc.query("""
                select id, legacy_id, row_key, name, category, session, class_day, class_time, fee, special_fee, active,
                       parent, phone, note, country, family, date_of_birth::text as dob, custom::text as custom, extra::text as extra
                from students order by position""", (rs, n) -> {
            Map<String, Object> s = new LinkedHashMap<>();
            put(s, "id", rs.getString("legacy_id"));
            s.put("name", rs.getString("name"));
            put(s, "key", rs.getString("row_key"));
            s.put("category", rs.getString("category"));
            put(s, "classDay", rs.getString("class_day"));
            put(s, "classTime", rs.getString("class_time"));
            s.put("sapaId", rs.getString("id"));
            put(s, "className", rs.getString("session"));
            put(s, "fee", Db.money(rs, "fee"));
            s.put("active", rs.getBoolean("active"));
            put(s, "specialFee", Db.money(rs, "special_fee"));
            put(s, "note", rs.getString("note"));
            put(s, "country", rs.getString("country"));
            put(s, "parent", rs.getString("parent"));
            put(s, "phone", rs.getString("phone"));
            put(s, "family", rs.getString("family"));
            put(s, "dateOfBirth", rs.getString("dob"));
            Map<String, Object> custom = db.jsonMap(rs.getString("custom"));
            if (!custom.isEmpty()) s.put("custom", custom);
            db.jsonMap(rs.getString("extra")).forEach(s::putIfAbsent);
            return s;
        });
        Map<String, Object> raw = new LinkedHashMap<>();
        raw.put("classes", new ArrayList<>(classes));
        raw.put("students", new ArrayList<>(students));
        raw.put("categories", new ArrayList<>(categories));
        return raw;
    }

    /* ---------------- the roster → tables ---------------- */

    /**
     * Saves the whole roster in one transaction. New and changed rows are written over the old
     * ones; rows no longer there are removed last, students first, so a renamed class or session
     * (a new name in, the old one out) never leaves a student pointing nowhere.
     */
    @Override
    protected void writeRaw(Map<String, Object> raw) {
        // Everything goes in a handful of batches rather than one statement per row: the database
        // may be a network hop away (Neon), and 200 single round trips made saving a student slow.
        db.inTx(() -> {
            List<Map<String, Object>> categories = maps(raw.get("categories"));
            List<Map<String, Object>> classes = maps(raw.get("classes"));
            List<Map<String, Object>> students = maps(raw.get("students"));

            Set<String> catNames = new LinkedHashSet<>();
            List<Object[]> catRows = new ArrayList<>();
            List<Object[]> changeRows = new ArrayList<>();
            for (int i = 0; i < categories.size(); i++) {
                Map<String, Object> c = categories.get(i);
                String name = str(c.get("name"));
                if (name == null || !catNames.add(name)) continue;
                catRows.add(new Object[]{name, i, dec(c.get("fee")), billing(c.get("billing")),
                        Db.intArray(ints(c.get("termMonths"))), !Boolean.FALSE.equals(c.get("usesSessions"))});
                Set<String> months = new HashSet<>();
                for (Map<String, Object> f : maps(c.get("changes"))) {
                    String from = str(f.get("from"));
                    BigDecimal fee = dec(f.get("fee"));
                    if (from == null || fee == null || !months.add(from)) continue;
                    changeRows.add(new Object[]{name, from, fee});
                }
            }
            // a class named only on its students or sessions (older files) is added so they can refer to it
            List<String> implied = new ArrayList<>();
            for (Map<String, Object> st : students) implied.add(str(st.get("category")));
            for (Map<String, Object> c : classes) implied.add(str(c.get("category")));
            List<Object[]> impliedRows = new ArrayList<>();
            for (String name : implied) {
                if (name == null || !catNames.add(name)) continue;
                impliedRows.add(new Object[]{name, catNames.size() + 100});
            }
            batch("""
                    insert into categories (name, position, fee, billing, term_months, uses_sessions)
                    values (?, ?, ?, ?, ?::int[], ?)
                    on conflict (name) do update set position = excluded.position, fee = excluded.fee,
                        billing = excluded.billing, term_months = excluded.term_months, uses_sessions = excluded.uses_sessions""", catRows);
            batch("insert into categories (name, position, billing) values (?, ?, 'monthly') on conflict do nothing", impliedRows);
            db.jdbc.update("delete from category_fee_changes");
            batch("insert into category_fee_changes (category, from_month, fee) values (?, ?, ?)", changeRows);

            Set<String> sessionNames = new LinkedHashSet<>();
            List<Object[]> sessionRows = new ArrayList<>();
            for (int i = 0; i < classes.size(); i++) {
                Map<String, Object> c = classes.get(i);
                String name = str(c.get("name"));
                if (name == null || !sessionNames.add(name)) continue;
                sessionRows.add(new Object[]{name, i, str(c.get("category")), str(c.get("day")), str(c.get("time")),
                        positiveInt(c.get("max")), str(c.get("family")), str(c.get("meaning")), str(c.get("symbol")),
                        str(c.get("symbolStyle"))});
            }
            batch("""
                    insert into sessions (name, position, category, day, time, max_students, family, meaning, symbol, symbol_style)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict (name) do update set position = excluded.position, category = excluded.category,
                        day = excluded.day, time = excluded.time, max_students = excluded.max_students,
                        family = excluded.family, meaning = excluded.meaning, symbol = excluded.symbol,
                        symbol_style = excluded.symbol_style""", sessionRows);

            Set<String> ids = new LinkedHashSet<>();
            List<Object[]> studentRows = new ArrayList<>();
            for (int i = 0; i < students.size(); i++) {
                Map<String, Object> st = students.get(i);
                String id = firstOf(st, "sapaId", "studentNo", "key", "code", "id");
                String name = str(st.get("name"));
                if (id == null || name == null || !ids.add(id)) continue;
                Map<String, Object> extra = new LinkedHashMap<>();
                st.forEach((k, v) -> { if (!COLUMNS.contains(k) && v != null) extra.put(k, v); });
                String session = str(st.get("className"));
                // a session that no longer exists stays on the student, as it would in the file
                if (session != null && !sessionNames.contains(session)) extra.put("className", session);
                studentRows.add(new Object[]{id, str(st.get("id")), str(st.get("key")), i, name, str(st.get("category")),
                        session != null && sessionNames.contains(session) ? session : null,
                        str(st.get("classDay")), str(st.get("classTime")), dec(st.get("fee")), dec(st.get("specialFee")),
                        !Boolean.FALSE.equals(st.get("active")), str(st.get("parent")), str(st.get("phone")), str(st.get("note")),
                        str(st.get("country")), str(st.get("family")), dateOrNull(st.get("dateOfBirth")),
                        db.toJson(st.get("custom") instanceof Map<?, ?> m ? m : Map.of()), db.toJson(extra)});
            }
            // a row that has not changed is left alone (the WHERE), so only real changes are written
            batch("""
                    insert into students (id, legacy_id, row_key, position, name, category, session, class_day, class_time,
                                          fee, special_fee, active, parent, phone, note, country, family, date_of_birth,
                                          custom, extra, updated_at)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::date, ?::jsonb, ?::jsonb, now())
                    on conflict (id) do update set legacy_id = excluded.legacy_id, row_key = excluded.row_key,
                        position = excluded.position, name = excluded.name, category = excluded.category,
                        session = excluded.session, class_day = excluded.class_day, class_time = excluded.class_time,
                        fee = excluded.fee, special_fee = excluded.special_fee, active = excluded.active,
                        parent = excluded.parent, phone = excluded.phone, note = excluded.note, country = excluded.country,
                        family = excluded.family, date_of_birth = excluded.date_of_birth, custom = excluded.custom,
                        extra = excluded.extra, updated_at = now()
                    where (students.legacy_id, students.row_key, students.position, students.name, students.category,
                           students.session, students.class_day, students.class_time, students.fee, students.special_fee,
                           students.active, students.parent, students.phone, students.note, students.country, students.family,
                           students.date_of_birth, students.custom, students.extra)
                      is distinct from
                          (excluded.legacy_id, excluded.row_key, excluded.position, excluded.name, excluded.category,
                           excluded.session, excluded.class_day, excluded.class_time, excluded.fee, excluded.special_fee,
                           excluded.active, excluded.parent, excluded.phone, excluded.note, excluded.country, excluded.family,
                           excluded.date_of_birth, excluded.custom, excluded.extra)""", studentRows);

            // removed last, each in one statement: students, then sessions, then classes
            db.jdbc.update("delete from students where not (id = any (?::text[]))", Db.textArray(List.copyOf(ids)));
            db.jdbc.update("delete from sessions where not (name = any (?::text[]))", Db.textArray(List.copyOf(sessionNames)));
            db.jdbc.update("delete from categories where not (name = any (?::text[]))", Db.textArray(List.copyOf(catNames)));
        });
    }

    /** one round trip for many rows */
    private void batch(String sql, List<Object[]> rows) {
        if (!rows.isEmpty()) db.jdbc.batchUpdate(sql, rows);
    }

    /* ---------------- helpers ---------------- */

    private static void put(Map<String, Object> m, String key, Object value) {
        if (value != null && !(value instanceof String s && s.isBlank())) m.put(key, value);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object list) {
        if (!(list instanceof List<?> l)) return List.of();
        return l.stream().filter(Map.class::isInstance).map(o -> (Map<String, Object>) o).toList();
    }

    private static String str(Object v) {
        if (v == null) return null;
        String t = String.valueOf(v).trim();
        return t.isEmpty() ? null : t;
    }

    private static String firstOf(Map<String, Object> m, String... keys) {
        for (String k : keys) {
            String v = str(m.get(k));
            if (v != null && !v.equals("-") && !v.equals("—")) return v;
        }
        return null;
    }

    private static BigDecimal dec(Object v) {
        if (v == null) return null;
        try {
            return new BigDecimal(String.valueOf(v).trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer positiveInt(Object v) {
        BigDecimal d = dec(v);
        return d == null || d.intValue() <= 0 ? null : d.intValue();
    }

    private static List<Integer> ints(Object v) {
        if (!(v instanceof List<?> l)) return List.of();
        List<Integer> out = new ArrayList<>();
        for (Object o : l) {
            BigDecimal d = dec(o);
            if (d != null) out.add(d.intValue());
        }
        return out;
    }

    /** a yyyy-MM-dd date, or null for anything else (an older file may hold free text) */
    private static String dateOrNull(Object v) {
        String t = str(v);
        return t != null && t.matches("\\d{4}-\\d{2}-\\d{2}") ? t : null;
    }

    private static String billing(Object v) {
        String b = str(v);
        return "term".equals(b) || "payg".equals(b) ? b : "monthly";
    }
}
