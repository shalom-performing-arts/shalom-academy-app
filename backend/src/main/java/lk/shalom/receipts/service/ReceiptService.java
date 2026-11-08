package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Receipt.LineItem;
import lk.shalom.receipts.repository.ReceiptRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Service
public class ReceiptService {

    static final List<String> MONTHS = List.of("January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December");

    private final ReceiptRepository repository;
    private final PaymentService payments;   // null in tests that only look at receipts

    @Autowired
    public ReceiptService(ReceiptRepository repository, PaymentService payments) {
        this.repository = repository;
        this.payments = payments;
    }

    ReceiptService(ReceiptRepository repository) {
        this(repository, null);
    }

    public List<Receipt> list() {
        return repository.findAll();
    }

    public Receipt get(String id) {
        return repository.findById(id).orElseThrow(() -> ApiException.notFound("No receipt with id " + id));
    }

    /** Saves a new receipt. The server assigns the id and works out the total itself. */
    public Receipt create(Receipt incoming) {
        return store(incoming, null);
    }

    /** Replaces a saved receipt, keeping when it was first created. */
    public Receipt update(String id, Receipt incoming) {
        Receipt existing = get(id);
        return store(incoming, existing);
    }

    /**
     * Records that the receipt went to the parent on WhatsApp. The fee was already marked paid
     * when the receipt was saved; this only notes when and to which number it was sent.
     */
    public Receipt markSent(String id, String to) {
        Receipt r = get(id);
        String digits = to == null ? "" : to.replaceAll("\\D", "");
        if (digits.length() < 8) {
            throw ApiException.badRequest("That WhatsApp number looks too short.");
        }
        return repository.save(r.withSent(Instant.now(), digits));
    }

    /**
     * @param removePayments also remove the payments the receipt recorded; otherwise they stay
     *                       on the Payments page as paid, just without a receipt
     */
    public void delete(String id, boolean removePayments) {
        if (!repository.deleteById(id)) {
            throw ApiException.notFound("No receipt with id " + id);
        }
        if (payments != null) payments.receiptDeleted(id, removePayments);
    }

    /** Payments stay recorded; they only lose their link to a receipt. */
    public int deleteAll() {
        List<Receipt> all = repository.findAll();
        int n = repository.deleteAll();
        if (payments != null) all.forEach(r -> payments.receiptDeleted(r.id(), false));
        return n;
    }

    /** Replaces every receipt with the ones from a backup, cleaned up the same way a save is. */
    public int replaceAll(List<Receipt> incoming) {
        List<Receipt> clean = new ArrayList<>();
        for (Receipt r : incoming == null ? List.<Receipt>of() : incoming) {
            if (r == null || isBlank(r.number())) {
                continue;
            }
            Instant created = r.createdAt() == null ? Instant.now() : r.createdAt();
            clean.add(r.withServerFields(
                    isBlank(r.id()) ? newId() : r.id(),
                    total(r.items()),
                    period(r),
                    created,
                    r.updatedAt()));
        }
        repository.replaceAll(clean);
        return clean.size();
    }

    private Receipt store(Receipt r, Receipt existing) {
        validate(r);
        repository.findByNumber(r.number().trim())
                .filter(other -> existing == null || !Objects.equals(other.id(), existing.id()))
                .ifPresent(other -> {
                    throw ApiException.conflict("Receipt number " + r.number() + " is already used by the receipt for "
                            + other.names() + ". Generate a new number and try again.");
                });

        Instant now = Instant.now();
        Receipt clean = new Receipt(
                existing == null ? newId() : existing.id(),
                r.number().trim(), r.date(), r.people(), r.student(), r.studentId(), r.category(),
                r.cls(), r.session(), r.day(), r.time(), r.month(), r.year(), period(r),
                r.items(), total(r.items()), r.method(), r.paidTo(), r.payer(), r.reference(), r.note(),
                existing == null ? now : existing.createdAt(),
                existing == null ? null : now,
                // being sent is the server's record, not something the form sends back
                existing == null ? null : existing.sentAt(),
                existing == null ? null : existing.sentTo());
        Receipt saved = repository.save(clean);
        // issuing a receipt marks the fee as paid on the Payments page
        if (payments != null) payments.syncFromReceipt(saved);
        return saved;
    }

    private static void validate(Receipt r) {
        if (r == null) {
            throw ApiException.badRequest("The receipt is empty.");
        }
        if (isBlank(r.student())) {
            throw ApiException.badRequest("Pick or type a student name first.");
        }
        if (r.people() != null && r.people().stream().anyMatch(p -> p == null || isBlank(p.name()))) {
            throw ApiException.badRequest("Add the second student, or switch the family option off.");
        }
        if (r.items() == null || r.items().isEmpty()) {
            throw ApiException.badRequest("Enter at least one fee amount.");
        }
        for (LineItem it : r.items()) {
            if (it == null || it.amount() == null || it.amount().signum() <= 0) {
                throw ApiException.badRequest("Every fee line needs an amount above zero.");
            }
        }
        if (isBlank(r.number())) {
            throw ApiException.badRequest("Receipt number is missing.");
        }
        if (isBlank(r.date())) {
            throw ApiException.badRequest("Receipt date is missing.");
        }
        try {
            LocalDate.parse(r.date());
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("Receipt date must look like 2026-11-03.");
        }
        if (isBlank(r.month()) || !MONTHS.contains(r.month())) {
            throw ApiException.badRequest("Pick the fee month.");
        }
        if (r.year() == null || r.year() < 2000 || r.year() > 2100) {
            throw ApiException.badRequest("Enter the fee year.");
        }
    }

    /** The total is always the sum of the lines, whatever the client sent. */
    private static BigDecimal total(List<LineItem> items) {
        if (items == null) {
            return BigDecimal.ZERO;
        }
        return items.stream()
                .map(i -> i == null || i.amount() == null ? BigDecimal.ZERO : i.amount())
                .reduce(BigDecimal.ZERO, BigDecimal::add)
                .setScale(2, RoundingMode.HALF_UP);
    }

    private static String period(Receipt r) {
        if (!isBlank(r.month()) && r.year() != null) {
            return r.month() + " " + r.year();
        }
        return r.period() == null ? "" : r.period();
    }

    private static String newId() {
        return "r" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    /* ---------------- reports ---------------- */

    /** Count and total per fee month, latest month first. */
    public List<MonthTotal> monthlyTotals() {
        Map<String, MonthTotal> groups = new LinkedHashMap<>();
        for (Receipt r : repository.findAll()) {
            String key = isBlank(r.period()) ? "—" : r.period();
            int sort = (r.year() == null ? 0 : r.year()) * 100 + MONTHS.indexOf(r.month()) + 1;
            BigDecimal t = r.total() == null ? BigDecimal.ZERO : r.total();
            groups.merge(key, new MonthTotal(key, 1, t, sort),
                    (a, b) -> new MonthTotal(a.period(), a.receipts() + 1, a.total().add(b.total()), a.sort()));
        }
        return groups.values().stream()
                .sorted((a, b) -> Integer.compare(b.sort(), a.sort()))
                .toList();
    }

    public record MonthTotal(String period, int receipts, BigDecimal total, int sort) {}

    /** Every receipt as CSV, with a byte-order mark so Excel opens it as UTF-8. */
    public String csv() {
        List<String> lines = new ArrayList<>();
        lines.add(row(Stream.of("Receipt No", "Date", "Student", "Student ID", "Category", "Class", "Day", "Time",
                "Fee Month", "Items", "Total", "Method", "Paid By", "Reference", "Note", "Sent on WhatsApp")));
        for (Receipt r : repository.findAll()) {
            String items = r.items() == null ? "" : r.items().stream()
                    .map(i -> i.desc() + (isBlank(i.sub()) ? "" : " (" + i.sub() + ")") + " = " + money(i.amount()))
                    .collect(Collectors.joining(" | "));
            lines.add(row(Stream.of(r.number(), r.date(), r.names(), r.studentId(), r.category(), r.cls(), r.day(),
                    r.time(), r.period(), items, r.total() == null ? "0.00" : r.total().setScale(2, RoundingMode.HALF_UP).toPlainString(),
                    r.method(), r.payer(), r.reference(), r.note(),
                    r.sentAt() == null ? "" : r.sentAt().toString().substring(0, 10) + " to +" + r.sentTo())));
        }
        return "﻿" + String.join("\r\n", lines);
    }

    private static String row(Stream<String> cells) {
        return cells.map(v -> "\"" + (v == null ? "" : v).replace("\"", "\"\"") + "\"")
                .collect(Collectors.joining(","));
    }

    private static String money(BigDecimal n) {
        DecimalFormat f = new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(Locale.US));
        return f.format(n == null ? BigDecimal.ZERO : n);
    }
}
