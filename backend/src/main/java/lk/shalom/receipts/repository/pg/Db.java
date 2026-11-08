package lk.shalom.receipts.repository.pg;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * What every database repository needs: the connection, transactions, JSON for the few document
 * columns, and small helpers for reading and writing values.
 */
@Component
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class Db {

    final JdbcTemplate jdbc;
    final TransactionTemplate tx;
    final JsonMapper json;

    public Db(JdbcTemplate jdbc, TransactionTemplate tx, JsonMapper json) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.json = json;
    }

    /** Runs {@code work} in one transaction: all of it is saved, or none of it. */
    <T> T inTx(Supplier<T> work) {
        return tx.execute(status -> work.get());
    }

    void inTx(Runnable work) {
        tx.executeWithoutResult(status -> work.run());
    }

    int count(String table) {
        Integer n = jdbc.queryForObject("select count(*) from " + table, Integer.class);
        return n == null ? 0 : n;
    }

    /* ---------------- JSON columns ---------------- */

    String toJson(Object value) {
        return value == null ? null : json.writeValueAsString(value);
    }

    <T> T fromJson(String text, Class<T> type) {
        return text == null ? null : json.readValue(text, type);
    }

    Map<String, Object> jsonMap(String text) {
        if (text == null || text.isBlank()) return new LinkedHashMap<>();
        Map<String, Object> m = json.readValue(text, new TypeReference<LinkedHashMap<String, Object>>() {});
        return m == null ? new LinkedHashMap<>() : m;
    }

    /* ---------------- values ---------------- */

    /** to the microsecond, which is what PostgreSQL keeps (Windows clocks give a tenth of one more) */
    static OffsetDateTime ts(Instant i) {
        return i == null ? null : i.truncatedTo(ChronoUnit.MICROS).atOffset(ZoneOffset.UTC);
    }

    static Instant instant(ResultSet rs, String col) throws SQLException {
        OffsetDateTime t = rs.getObject(col, OffsetDateTime.class);
        return t == null ? null : t.toInstant();
    }

    static Integer integer(ResultSet rs, String col) throws SQLException {
        int v = rs.getInt(col);
        return rs.wasNull() ? null : v;
    }

    static Double dbl(ResultSet rs, String col) throws SQLException {
        double v = rs.getDouble(col);
        return rs.wasNull() ? null : v;
    }

    static Boolean bool(ResultSet rs, String col) throws SQLException {
        boolean v = rs.getBoolean(col);
        return rs.wasNull() ? null : v;
    }

    /** a money value as the JSON files had it: 8000, not 8000.00 */
    static BigDecimal money(ResultSet rs, String col) throws SQLException {
        BigDecimal v = rs.getBigDecimal(col);
        if (v == null) return null;
        BigDecimal s = v.stripTrailingZeros();
        return s.scale() < 0 ? s.setScale(0) : s;
    }

    /** {"Monday","Saturday"}, for a text[] column */
    static String textArray(List<String> list) {
        if (list == null || list.isEmpty()) return "{}";
        StringBuilder b = new StringBuilder("{");
        for (int i = 0; i < list.size(); i++) {
            if (i > 0) b.append(',');
            b.append('"').append(String.valueOf(list.get(i)).replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
        }
        return b.append('}').toString();
    }

    static String intArray(List<Integer> list) {
        if (list == null || list.isEmpty()) return "{}";
        return "{" + String.join(",", list.stream().filter(Objects::nonNull).map(String::valueOf).toList()) + "}";
    }

    static List<String> strings(ResultSet rs, String col) throws SQLException {
        Array a = rs.getArray(col);
        if (a == null) return new ArrayList<>();
        Object[] values = (Object[]) a.getArray();
        return new ArrayList<>(Arrays.stream(values).map(String::valueOf).toList());
    }

    static List<Integer> ints(ResultSet rs, String col) throws SQLException {
        Array a = rs.getArray(col);
        if (a == null) return new ArrayList<>();
        Object[] values = (Object[]) a.getArray();
        return new ArrayList<>(Arrays.stream(values).map(o -> ((Number) o).intValue()).toList());
    }

    static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s;
    }

    /* ---------------- saving only what changed ---------------- */

    /** One row to write: where it sits in its list, and the row. */
    record At<T>(int position, T item) {}

    /** What changed between two versions of a list: rows to write, and keys of rows to remove. */
    record Changes<T, K>(List<At<T>> upserts, List<K> deletes) {
        boolean none() {
            return upserts.isEmpty() && deletes.isEmpty();
        }
    }

    /**
     * Compares two versions of a list by key. A row is written when it is new, different, or (when
     * {@code positional}) has moved; a key no longer there is removed.
     */
    static <T, K> Changes<T, K> diff(List<T> before, List<T> after, Function<T, K> key, boolean positional) {
        Map<K, At<T>> old = new LinkedHashMap<>();
        for (int i = 0; i < before.size(); i++) old.put(key.apply(before.get(i)), new At<>(i, before.get(i)));
        List<At<T>> up = new ArrayList<>();
        for (int i = 0; i < after.size(); i++) {
            T item = after.get(i);
            At<T> was = old.remove(key.apply(item));
            if (was == null || !was.item().equals(item) || (positional && was.position() != i)) up.add(new At<>(i, item));
        }
        return new Changes<>(up, new ArrayList<>(old.keySet()));
    }
}
