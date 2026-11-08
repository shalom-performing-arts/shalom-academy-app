package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Everything about teachers, kept in data/teachers.json: who they are, what a class pays,
 * the weekly timetable, holidays, where the academy is (for checking in from a phone), the
 * attendance itself, and the salary adjustments and payouts per pay period.
 *
 * <p>Pay periods run from the 26th to the 25th, and are named after the month they are paid
 * in: period "2026-11" is 26 Oct – 25 Nov 2026, paid on 25 Nov.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record TeacherBook(
        List<Teacher> teachers,
        Rates rates,
        List<Slot> schedule,
        List<Holiday> holidays,
        Site site,
        List<Mark> attendance,
        List<Adjustment> adjustments,
        List<Payout> payouts,
        List<Arrival> arrivals
) {

    /**
     * @param pinHash salted SHA-256 of the teacher's PIN; null = no PIN yet, so they cannot sign in
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Teacher(String id, String name, String phone, String colour, Boolean active,
                          String pinSalt, String pinHash) {
        public boolean isActive() { return active == null || active; }
        public boolean hasPin() { return pinHash != null && !pinHash.isBlank(); }
    }

    /**
     * @param transportMinClasses transport is paid once a teacher has taken this many classes in
     *                            the period (the workbook: at least 1)
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Rates(BigDecimal weekday, BigDecimal weekend, BigDecimal transport, Integer transportMinClasses) {
        public static Rates defaults() {
            return new Rates(new BigDecimal("700"), new BigDecimal("600"), new BigDecimal("5000"), 1);
        }
        public int minClasses() { return transportMinClasses == null || transportMinClasses < 0 ? 1 : transportMinClasses; }
    }

    /**
     * One class in the weekly timetable.
     *
     * @param day     "Saturday"
     * @param start   "09:30", 24-hour
     * @param minutes how long it runs
     * @param label   what it is called on the attendance sheet, e.g. "Youth 1"
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Slot(String id, String day, String start, Integer minutes, String category, String label) {
        public int length() { return minutes == null || minutes <= 0 ? 60 : minutes; }
    }

    /** @param classOff true = no classes that day (mercantile holidays); false = classes as usual */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Holiday(String date, String name, Boolean classOff) {
        public boolean off() { return classOff != null && classOff; }
    }

    /**
     * Where the academy is, for checking in by phone.
     *
     * @param radius       metres from the academy a check-in is accepted
     * @param earlyMinutes how long before a class starts its check-in opens
     * @param lateMinutes  how long after a class ends its check-in stays open
     * @param doneMinutes  how long after a class ends "class done" can still be marked
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Site(Double lat, Double lng, Integer radius, Integer earlyMinutes, Integer lateMinutes,
                       Integer doneMinutes) {
        /** "Class done" opens this many minutes before a class ends. */
        public static final int DONE_EARLY = 10;

        public Site(Double lat, Double lng, Integer radius, Integer earlyMinutes, Integer lateMinutes) {
            this(lat, lng, radius, earlyMinutes, lateMinutes, null);
        }
        public static Site defaults() { return new Site(null, null, 150, 45, 15, 60); }
        public boolean isSet() { return lat != null && lng != null; }
        public int radiusM() { return radius == null || radius < 20 ? 150 : radius; }
        public int early() { return earlyMinutes == null || earlyMinutes < 0 ? 45 : earlyMinutes; }
        public int late() { return lateMinutes == null || lateMinutes < 0 ? 15 : lateMinutes; }
        public int done() { return doneMinutes == null || doneMinutes < 0 ? 60 : doneMinutes; }
    }

    /**
     * A teacher took a class on a date.
     *
     * @param method       "self" = checked in from their phone at the academy; "office" = ticked by the office
     * @param distance     metres from the academy at check-in
     * @param doneAt       when the teacher confirmed, after the class, that it was taught; null = not yet
     * @param note         what was covered, as the teacher wrote it when marking the class done
     * @param doneDistance metres from the academy when marking it done
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Mark(String date, String slotId, String teacherId, String method, Instant at,
                       Double lat, Double lng, Double accuracy, Double distance,
                       Instant doneAt, String note, Double doneDistance) {

        public Mark(String date, String slotId, String teacherId, String method, Instant at,
                    Double lat, Double lng, Double accuracy, Double distance) {
            this(date, slotId, teacherId, method, at, lat, lng, accuracy, distance, null, null, null);
        }

        public Mark withDone(Instant when, String note, Double distance) {
            return new Mark(date, slotId, teacherId, method, at, lat, lng, accuracy, this.distance, when, note, distance);
        }

        /** The office's ticks need no "done": the office only ticks classes that were taught. */
        public boolean finished() {
            return doneAt != null || !"self".equals(method);
        }
    }

    /** A plus or minus on one teacher's pay for one period, e.g. -2500 for an advance. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Adjustment(String period, String teacherId, BigDecimal amount, String note) {}

    /** The salary for a period was paid. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Payout(String period, String teacherId, BigDecimal amount, Instant paidAt) {}

    /**
     * When a teacher first opened the app at the academy that day: their reported time.
     * One per teacher per day; taken from the server clock, with where the phone was.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Arrival(String date, String teacherId, Instant at, Double lat, Double lng, Double accuracy, Double distance) {}

    public static TeacherBook empty() {
        return new TeacherBook(new ArrayList<>(), Rates.defaults(), new ArrayList<>(), new ArrayList<>(),
                Site.defaults(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>(), new ArrayList<>());
    }

    /** Lists never null and settings filled, whatever an older file left out. */
    public TeacherBook clean() {
        Rates r = rates == null ? Rates.defaults() : new Rates(
                nz(rates.weekday(), Rates.defaults().weekday()), nz(rates.weekend(), Rates.defaults().weekend()),
                nz(rates.transport(), Rates.defaults().transport()), rates.minClasses());
        Site s = site == null ? Site.defaults() : new Site(site.lat(), site.lng(), site.radiusM(), site.early(), site.late(), site.done());
        return new TeacherBook(list(teachers), r, list(schedule), list(holidays), s, list(attendance),
                list(adjustments), list(payouts), list(arrivals));
    }

    private static <T> List<T> list(List<T> in) {
        return in == null ? new ArrayList<>() : new ArrayList<>(in);
    }

    private static BigDecimal nz(BigDecimal v, BigDecimal d) {
        return v == null || v.signum() < 0 ? d : v;
    }
}
