package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * A full export: settings, receipts, payments, months, the student file and online registrations.
 *
 * <p>A backup made by the original browser-only app has only settings and receipts (and a
 * {@code roster} of its own, which is ignored), so restoring one replaces those two and leaves
 * students, payments and months as they are.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Backup(
        String app,
        Integer version,
        Instant exportedAt,
        AppSettings settings,
        List<Receipt> receipts,
        List<Payment> payments,
        List<MonthSheet> months,
        Map<String, Object> students,
        RegistrationBook registrations   // online registrations; absent in older backups
) {
    public static final String APP_ID = "shalom-fee-receipts";
}
