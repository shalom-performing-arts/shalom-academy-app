package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Payment;
import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Receipt.LineItem;
import lk.shalom.receipts.model.Receipt.Person;
import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Student;
import lk.shalom.receipts.repository.PaymentRepository;
import lk.shalom.receipts.repository.RosterRepository;
import lk.shalom.receipts.repository.SettingsRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Recording payments, by hand on the Payments page or by issuing a receipt.
 *
 * <p>A receipt and its payments stay in step: saving a receipt creates or updates one payment
 * per fee line, and a fee already marked as paid on the Payments page is linked to the receipt
 * instead of being counted twice.
 */
@Service
public class PaymentService {

    private final PaymentRepository payments;
    private final MonthService months;
    private final RosterRepository roster;
    private final SettingsRepository settings;

    public PaymentService(PaymentRepository payments, MonthService months, RosterRepository roster,
                          SettingsRepository settings) {
        this.payments = payments;
        this.months = months;
        this.roster = roster;
        this.settings = settings;
    }

    public record PaymentInput(String studentId, String month, String kind, BigDecimal amount, String paidTo,
                               String date, String note) {}

    /** Records a payment. With no amount, a monthly payment pays whatever is still owed. */
    public synchronized Payment create(PaymentInput in) {
        String month = MonthService.check(in.month());
        Student s = student(in.studentId())
                .orElseThrow(() -> ApiException.badRequest("No student with id " + in.studentId() + "."));
        String kind = kind(in.kind());
        months.start(month);
        months.ensureDue(month, s.id());

        BigDecimal amount = in.amount();
        if (amount == null && Payment.MONTHLY.equals(kind)) {
            amount = months.view(month).rows().stream().filter(r -> r.studentId().equals(s.id()))
                    .findFirst().map(MonthService.Row::outstanding).orElse(BigDecimal.ZERO);
            if (amount.signum() == 0) {
                throw ApiException.badRequest(s.name() + " has nothing left to pay for " + MonthService.label(month)
                        + ". Type an amount to record a payment anyway.");
            }
        }
        checkAmount(amount);
        return payments.save(new Payment(newId(), s.id(), s.name(), month, kind, amount, paidTo(in.paidTo()),
                date(in.date()), clean(in.note()), null, null, Instant.now()));
    }

    /** Changes where the money went, the date or the note; the amount too, unless a receipt holds it. */
    public synchronized Payment update(String id, PaymentInput in) {
        Payment p = get(id);
        BigDecimal amount = p.amount();
        if (in.amount() != null && in.amount().compareTo(p.amount()) != 0) {
            if (p.receiptId() != null) {
                throw ApiException.conflict("This amount comes from receipt " + p.receiptNumber()
                        + ". Open the receipt to change it, so the two stay the same.");
            }
            checkAmount(in.amount());
            amount = in.amount();
        }
        return payments.save(p.with(p.month(), amount,
                in.paidTo() == null ? p.paidTo() : paidTo(in.paidTo()),
                in.date() == null ? p.date() : date(in.date()),
                in.note() == null ? p.note() : clean(in.note()),
                p.receiptId(), p.receiptNumber()));
    }

    public synchronized void delete(String id) {
        if (!payments.deleteById(id)) throw ApiException.notFound("No payment with id " + id + ".");
    }

    public Payment get(String id) {
        return payments.findById(id).orElseThrow(() -> ApiException.notFound("No payment with id " + id + "."));
    }

    /* ---------------- receipts ---------------- */

    /** Brings the payments for a saved receipt in line with its fee lines. */
    public synchronized void syncFromReceipt(Receipt r) {
        String month = MonthService.key(r.month(), r.year());
        if (month == null || r.id() == null) return;
        Roster ros = roster.load();
        List<Person> people = r.people() != null && !r.people().isEmpty() ? r.people()
                : List.of(new Person(r.student(), r.studentId(), r.category(), r.cls(), r.day(), r.time(), r.session()));
        String paidTo = paidTo(r.paidTo() != null && !r.paidTo().isBlank() ? r.paidTo()
                : "Cash".equalsIgnoreCase(r.method()) ? "Cash" : null);

        List<Payment> linked = new ArrayList<>(payments.findByReceipt(r.id()));
        for (LineItem item : r.items() == null ? List.<LineItem>of() : r.items()) {
            if (item == null || item.amount() == null || item.amount().signum() <= 0) continue;
            Person who = person(people, item.sub());
            Student s = match(ros, who).orElse(null);
            String studentId = s == null ? null : s.id();
            String name = s == null ? (who == null ? r.student() : who.name()) : s.name();
            String kind = itemKind(item);
            String note = Payment.OTHER.equals(kind) ? item.desc() : null;

            // the same line saved before …
            Payment p = take(linked, x -> kind.equals(x.kind()) && (studentId != null
                    ? studentId.equals(x.studentId())
                    : x.studentId() == null && Objects.equals(x.studentName(), name)));
            // … or a fee already recorded on the Payments page, now getting its receipt
            if (p == null && studentId != null && !Payment.OTHER.equals(kind)) {
                p = payments.findByMonth(month).stream()
                        .filter(x -> studentId.equals(x.studentId()) && kind.equals(x.kind()) && x.receiptId() == null)
                        .findFirst().orElse(null);
            }
            Payment saved = p == null
                    ? new Payment(newId(), studentId, name, month, kind, item.amount(), paidTo, r.date(), note,
                            r.id(), r.number(), Instant.now())
                    : p.with(month, item.amount(), paidTo, r.date(), note, r.id(), r.number());
            payments.save(saved);
            if (studentId != null) {
                months.start(month);
                months.ensureDue(month, studentId);
            }
        }
        // lines taken off the receipt
        for (Payment gone : linked) payments.deleteById(gone.id());
    }

    /** A receipt was deleted: either remove its payments, or keep them as paid without a receipt. */
    public synchronized void receiptDeleted(String receiptId, boolean removePayments) {
        for (Payment p : payments.findByReceipt(receiptId)) {
            if (removePayments) payments.deleteById(p.id());
            else payments.save(p.with(p.month(), p.amount(), p.paidTo(), p.date(), p.note(), null, null));
        }
    }

    /* ---------------- helpers ---------------- */

    private Optional<Student> student(String id) {
        if (id == null) return Optional.empty();
        return roster.load().students().stream().filter(s -> id.equals(s.id())).findFirst();
    }

    /** The receipt's person for a line: by the child's name when two share it. */
    private static Person person(List<Person> people, String sub) {
        if (people.size() > 1 && sub != null && !sub.isBlank()) {
            for (Person p : people) if (sub.equalsIgnoreCase(p.name())) return p;
        }
        return people.getFirst();
    }

    private static Optional<Student> match(Roster r, Person p) {
        if (p == null) return Optional.empty();
        if (p.id() != null && !p.id().isBlank()) {
            Optional<Student> byId = r.students().stream().filter(s -> p.id().equals(s.id())).findFirst();
            if (byId.isPresent()) return byId;
        }
        return r.students().stream().filter(s -> p.name() != null && s.name().equalsIgnoreCase(p.name().trim())).findFirst();
    }

    /** Receipts saved before fee lines carried a kind say "… Class Fee" or "Admission Fee". */
    private String itemKind(LineItem it) {
        if ("monthly".equals(it.kind())) return Payment.MONTHLY;
        if ("admission".equals(it.kind())) return Payment.ADMISSION;
        if (it.kind() != null && settings.get().isFeeType(it.kind())) return it.kind();
        if (it.kind() == null && it.desc() != null) {
            if (it.desc().matches("(?i).*class fee$")) return Payment.MONTHLY;
            if (it.desc().equalsIgnoreCase("Admission Fee")) return Payment.ADMISSION;
        }
        return Payment.OTHER;
    }

    private static Payment take(List<Payment> list, java.util.function.Predicate<Payment> test) {
        for (int i = 0; i < list.size(); i++) {
            if (test.test(list.get(i))) return list.remove(i);
        }
        return null;
    }

    /** Monthly, admission, "other", or any fee type set up in Settings. */
    private String kind(String k) {
        if (k == null || k.isBlank() || Payment.MONTHLY.equals(k)) return Payment.MONTHLY;
        if (Payment.ADMISSION.equals(k) || Payment.OTHER.equals(k) || settings.get().isFeeType(k)) return k;
        throw ApiException.badRequest("“" + k + "” is not one of the fee types in Settings.");
    }

    private String paidTo(String v) {
        return v == null || v.isBlank() ? settings.get().defaultPaidTo() : v.trim();
    }

    private static String date(String v) {
        if (v == null || v.isBlank()) return MonthService.today();
        try {
            return LocalDate.parse(v.trim()).toString();
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("A date looks like 2026-11-03.");
        }
    }

    private static void checkAmount(BigDecimal amount) {
        if (amount == null || amount.signum() <= 0) throw ApiException.badRequest("Enter an amount above zero.");
    }

    private static String clean(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String newId() {
        return "p" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }
}
