package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.time.Instant;

/**
 * Money received for one student in one fee month. A part payment is simply one of several
 * payments for the same student and month.
 *
 * @param studentId     the SAPA number; null for a receipt written for a name not on the roster
 * @param month         the fee month it pays for, "2026-11", which need not be the month it arrived
 * @param kind          "monthly", "admission" or "other"
 * @param paidTo        where the money went: one of the options in Settings, e.g. "Cash"
 * @param date          the day it was paid, "2026-11-03"
 * @param receiptId     the receipt that recorded it, once one has been issued
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Payment(
        String id,
        String studentId,
        String studentName,
        String month,
        String kind,
        BigDecimal amount,
        String paidTo,
        String date,
        String note,
        String receiptId,
        String receiptNumber,
        Instant createdAt
) {
    public static final String MONTHLY = "monthly";
    public static final String ADMISSION = "admission";
    public static final String OTHER = "other";

    public Payment with(String month, BigDecimal amount, String paidTo, String date, String note,
                        String receiptId, String receiptNumber) {
        return new Payment(id, studentId, studentName, month, kind, amount, paidTo, date, note,
                receiptId, receiptNumber, createdAt);
    }
}
