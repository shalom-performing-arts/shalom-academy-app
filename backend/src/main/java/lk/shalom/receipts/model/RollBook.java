package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Student attendance, kept in data/student-attendance.json: one entry per student per class
 * day, the app version of the monthly paper register (P = present, ab = absent, L = late), and
 * the cover-up classes booked for students who missed one.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RollBook(List<Entry> entries, List<Makeup> makeups) {

    public static final String PRESENT = "P";
    public static final String LATE = "L";
    public static final String ABSENT = "A";
    /** missed, then attended a cover-up class in another session; counts as attended */
    public static final String MADE_UP = "M";

    /**
     * @param session     the class session, e.g. "Forte"
     * @param studentName kept so the register still reads right if the student later leaves
     * @param status      P, L, A, or M (set only through a cover-up)
     * @param by          who marked it: a teacher's id, or "office"
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Entry(String date, String session, String studentId, String studentName, String status,
                        String note, String by, String byName, Instant at) {}

    /**
     * A cover-up class: a student who missed {@code fromSession} on {@code fromDate} comes to
     * {@code toSession} on {@code toDate} instead.
     *
     * @param status "booked", then "attended" or "missed" once the cover-up class is marked
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Makeup(String id, String studentId, String studentName, String fromSession, String fromDate,
                         String toSession, String toDate, String status, String note, String by, String byName,
                         Instant at) {
        public static final String BOOKED = "booked";
        public static final String ATTENDED = "attended";
        public static final String MISSED = "missed";

        public Makeup withStatus(String s) {
            return new Makeup(id, studentId, studentName, fromSession, fromDate, toSession, toDate, s, note, by, byName, at);
        }
    }

    public static RollBook empty() {
        return new RollBook(new ArrayList<>(), new ArrayList<>());
    }

    public RollBook clean() {
        return new RollBook(entries == null ? new ArrayList<>() : new ArrayList<>(entries),
                makeups == null ? new ArrayList<>() : new ArrayList<>(makeups));
    }

    /** the marks a person can give; M only comes from a cover-up */
    public static boolean valid(String status) {
        return PRESENT.equals(status) || LATE.equals(status) || ABSENT.equals(status);
    }

    public static boolean attended(String status) {
        return PRESENT.equals(status) || LATE.equals(status) || MADE_UP.equals(status);
    }
}
