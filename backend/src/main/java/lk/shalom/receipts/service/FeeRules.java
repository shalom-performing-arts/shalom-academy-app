package lk.shalom.receipts.service;

import lk.shalom.receipts.model.AppSettings.SiblingDiscount;
import lk.shalom.receipts.model.Roster;
import lk.shalom.receipts.model.Roster.Category;
import lk.shalom.receipts.model.Roster.Student;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;

/**
 * What a student owes for a month, from the class's billing and fee schedule, their special
 * fee, and the sibling discount. The one place these rules live.
 */
public final class FeeRules {

    private FeeRules() {}

    /**
     * @param fee       what is owed; null = no set fee (pay as you go)
     * @param discount  the sibling discount already taken off {@code fee}, or zero
     * @param notBilled true in a month a term-billed class charges nothing
     */
    public record Fee(BigDecimal fee, BigDecimal discount, boolean notBilled) {}

    public static Fee forMonth(Roster r, Student s, String month, SiblingDiscount sibling) {
        Category c = r.category(s.category());
        if (c != null && !c.billedIn(month)) return new Fee(BigDecimal.ZERO, BigDecimal.ZERO, true);
        // a special fee is this student's own arrangement and is never discounted further
        if (s.specialFee() != null) return new Fee(s.specialFee(), BigDecimal.ZERO, false);
        BigDecimal base = c == null ? s.fee() : c.feeOn(month);
        if (base == null) return new Fee(null, BigDecimal.ZERO, false);
        BigDecimal off = siblingDiscount(r, s, month, base, sibling);
        return new Fee(base.subtract(off), off, false);
    }

    /**
     * The second and later children of a family get the discount; the eldest-listed child on
     * the highest fee pays in full. Only children on the class fee, active and billed that
     * month, count as siblings for this.
     */
    static BigDecimal siblingDiscount(Roster r, Student s, String month, BigDecimal base, SiblingDiscount d) {
        if (d == null || !d.enabled() || d.value() == null || d.value().signum() <= 0) return BigDecimal.ZERO;
        if (s.family() == null || s.family().isBlank()) return BigDecimal.ZERO;
        List<Student> family = r.students().stream()
                .filter(x -> x.active() && x.specialFee() == null && s.family().equalsIgnoreCase(x.family()))
                .filter(x -> {
                    Category c = r.category(x.category());
                    return c == null || (c.billedIn(month) && c.feeOn(month) != null);
                })
                .toList();
        if (family.size() < 2) return BigDecimal.ZERO;
        // who pays in full: the highest fee, then whoever is listed first
        Student first = family.stream()
                .max(Comparator.comparing((Student x) -> nz(baseFee(r, x, month)))
                        .thenComparing(x -> -r.students().indexOf(x)))
                .orElseThrow();
        if (first.id().equals(s.id())) return BigDecimal.ZERO;
        BigDecimal off = SiblingDiscount.AMOUNT.equals(d.type())
                ? d.value()
                : base.multiply(d.value()).divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP);
        return off.min(base);
    }

    private static BigDecimal baseFee(Roster r, Student s, String month) {
        Category c = r.category(s.category());
        return c == null ? s.fee() : c.feeOn(month);
    }

    private static BigDecimal nz(BigDecimal b) {
        return b == null ? BigDecimal.ZERO : b;
    }
}
