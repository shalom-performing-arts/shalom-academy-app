package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * One issued fee receipt.
 *
 * <p>The shape matches what the original browser-only app kept in localStorage, so a backup
 * exported from it can be restored here unchanged. The first student is also kept in the flat
 * fields ({@code student}, {@code studentId}, ...) so history search and the CSV export work
 * the same for one or two students.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Receipt(
        String id,
        String number,
        String date,            // yyyy-MM-dd, the date printed on the receipt
        List<Person> people,
        String student,
        String studentId,
        String category,
        String cls,             // the course: "Guitar and Vocal", "Ukulele and Vocal"
        String session,         // the class session the student sits in: "Andante", "Forte"
        String day,
        String time,
        String month,           // fee month, "November"
        Integer year,
        String period,          // "November 2026"
        List<LineItem> items,
        BigDecimal total,
        String method,
        String paidTo,          // where the money went (Settings → Paid to); not printed
        String payer,
        String reference,
        String note,
        Instant createdAt,
        Instant updatedAt,
        Instant sentAt,         // when it was sent to the parent on WhatsApp; null = not sent from the app
        String sentTo           // the WhatsApp number it went to, international form: 94710407740
) {

    /** A receipt that has not been sent on WhatsApp yet. */
    public Receipt(String id, String number, String date, List<Person> people, String student, String studentId,
                   String category, String cls, String session, String day, String time, String month,
                   Integer year, String period, List<LineItem> items, BigDecimal total, String method,
                   String paidTo, String payer, String reference, String note, Instant createdAt, Instant updatedAt) {
        this(id, number, date, people, student, studentId, category, cls, session, day, time, month, year, period,
                items, total, method, paidTo, payer, reference, note, createdAt, updatedAt, null, null);
    }

    /** A student named on the receipt. Siblings paying together give two. */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Person(
            String name,
            String id,
            String category,
            String cls,
            String day,
            String time,
            String session
    ) {}

    /**
     * One line of the fee table. {@code kind} is what the form reloads from ("monthly",
     * "admission", or null for an other charge); {@code desc} is only what gets printed.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record LineItem(
            String kind,
            String desc,
            String sub,         // the child's name, when two students share the receipt
            BigDecimal amount
    ) {}

    public Receipt withServerFields(String id, BigDecimal total, String period,
                                    Instant createdAt, Instant updatedAt) {
        return new Receipt(id, number, date, people, student, studentId, category, cls, session,
                day, time, month, year, period, items, total, method, paidTo, payer, reference, note,
                createdAt, updatedAt, sentAt, sentTo);
    }

    public Receipt withSent(Instant at, String to) {
        return new Receipt(id, number, date, people, student, studentId, category, cls, session,
                day, time, month, year, period, items, total, method, paidTo, payer, reference, note,
                createdAt, updatedAt, at, to);
    }

    /** Names shown in history and file names: "Nimali Perera + Ravindu Perera" for siblings. */
    public String names() {
        if (people != null && people.size() > 1) {
            return String.join(" + ", people.stream().map(Person::name).toList());
        }
        return student == null ? "" : student;
    }
}
