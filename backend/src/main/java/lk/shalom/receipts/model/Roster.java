package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.YearMonth;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Students, the class sessions they sit in, and the classes with their fees and billing. */
public record Roster(List<Student> students, List<Session> sessions, List<Category> categories) {

    public Category category(String name) {
        if (name == null) return null;
        return categories.stream().filter(c -> c.name().equalsIgnoreCase(name.trim())).findFirst().orElse(null);
    }

    /**
     * One student.
     *
     * @param id         the academy number printed on receipts (SAPA-1002); never changes
     * @param category   the class: Kids, Junior, Youth, Adult, Online, or any class added later
     * @param session    the class session they sit in, e.g. "Andante"; blank when not yet placed
     * @param fee        the monthly fee charged now: the special fee when there is one,
     *                   otherwise the class fee. Null means no fee is set (pay as you go);
     *                   0 is a free place.
     * @param specialFee a fee for this one student instead of the class fee; null = class fee
     * @param family     students with the same family name are siblings (for the sibling discount)
     * @param custom     the extra fields set up in Settings, by key
     * @param dateOfBirth yyyy-MM-dd; blank when not known
     */
    public record Student(
            String name,
            String id,
            String category,
            String day,
            String time,
            String session,
            BigDecimal fee,
            BigDecimal specialFee,
            boolean active,
            String parent,
            String phone,
            String note,
            String country,
            String family,
            Map<String, String> custom,
            String dateOfBirth
    ) {}

    /**
     * A class session and the musical term behind its name: Andante, Tempo, "at a walking pace".
     *
     * @param max the most students the session should take; null = no limit set
     */
    public record Session(
            String name,
            String family,
            String meaning,
            String symbol,
            String symbolStyle,
            String category,
            String day,
            String time,
            Integer max
    ) {}

    /**
     * A class, its fee and how it is billed.
     *
     * @param fee          the fee before any scheduled change
     * @param billing      "monthly", "term" (only in {@code termMonths}) or "payg" (no set fee)
     * @param termMonths   for term billing: the months the fee is due, 1 = January
     * @param usesSessions false for classes such as Online, whose students have no session
     * @param changes      fee changes that start in a given month, e.g. 9000 from 2027-01
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Category(String name, BigDecimal fee, String billing, List<Integer> termMonths,
                           Boolean usesSessions, List<FeeChange> changes) {

        public static final String MONTHLY = "monthly";
        public static final String TERM = "term";
        public static final String PAYG = "payg";

        public Category(String name, BigDecimal fee) {
            this(name, fee, MONTHLY, List.of(), true, List.of());
        }

        public String billingMode() {
            return TERM.equals(billing) || PAYG.equals(billing) ? billing : MONTHLY;
        }

        public boolean hasSessions() {
            return usesSessions == null || usesSessions;
        }

        /** The class fee for a month, after any change scheduled up to then. Null when pay as you go. */
        public BigDecimal feeOn(String month) {
            if (PAYG.equals(billingMode())) return null;
            BigDecimal f = fee;
            if (changes != null) {
                for (FeeChange c : changes.stream().sorted(Comparator.comparing(FeeChange::from)).toList()) {
                    if (c.from() != null && c.from().compareTo(month) <= 0) f = c.fee();
                }
            }
            return f;
        }

        /** False in the months a term-billed class charges nothing. */
        public boolean billedIn(String month) {
            if (!TERM.equals(billingMode())) return true;
            int m = YearMonth.parse(month).getMonthValue();
            return termMonths != null && termMonths.contains(m);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FeeChange(String from, BigDecimal fee) {}

    /** A class as saved from the app. {@code from} is its old name when it is being renamed. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CategoryInput(String name, String from, BigDecimal fee, String billing, List<Integer> termMonths,
                                Boolean usesSessions, List<FeeChange> changes) {}

    /** What can be set on a student from the app. The id is assigned by the server. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record StudentInput(
            String name,
            String category,
            String session,
            BigDecimal specialFee,
            Boolean active,
            String parent,
            String phone,
            String note,
            String country,
            String family,
            Map<String, String> custom,
            String dateOfBirth   // yyyy-MM-dd; null leaves it as it is, blank clears it
    ) {
        public StudentInput(String name, String category, String session, BigDecimal specialFee, Boolean active,
                            String parent, String phone, String note, String country) {
            this(name, category, session, specialFee, active, parent, phone, note, country, null, null, null);
        }

        public StudentInput(String name, String category, String session, BigDecimal specialFee, Boolean active,
                            String parent, String phone, String note, String country, String family,
                            Map<String, String> custom) {
            this(name, category, session, specialFee, active, parent, phone, note, country, family, custom, null);
        }
    }

    /** What can be set on a session from the app. {@code rename} gives it a new name. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SessionInput(
            String name,
            String category,
            String day,
            String time,
            Integer max,
            String meaning,
            String family,
            String symbol,
            String symbolStyle,
            String rename
    ) {
        public SessionInput(String name, String category, String day, String time, Integer max,
                            String meaning, String family, String symbol, String symbolStyle) {
            this(name, category, day, time, max, meaning, family, symbol, symbolStyle, null);
        }
    }
}
