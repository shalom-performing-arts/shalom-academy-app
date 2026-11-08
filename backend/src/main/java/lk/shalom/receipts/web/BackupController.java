package lk.shalom.receipts.web;

import lk.shalom.receipts.model.AppSettings;
import lk.shalom.receipts.model.Backup;
import lk.shalom.receipts.repository.RegistrationRepository;
import lk.shalom.receipts.repository.MonthRepository;
import lk.shalom.receipts.repository.PaymentRepository;
import lk.shalom.receipts.repository.RosterRepository;
import lk.shalom.receipts.repository.SettingsRepository;
import lk.shalom.receipts.service.ApiException;
import lk.shalom.receipts.service.ReceiptService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Export and restore of everything the app keeps. Restore also accepts a backup made by the
 * original browser-only app, which is how receipts kept in a browser move onto the server.
 */
@RestController
@RequestMapping("/api/backup")
public class BackupController {

    private final SettingsRepository settings;
    private final ReceiptService receipts;
    private final PaymentRepository payments;
    private final MonthRepository months;
    private final RosterRepository roster;
    private final RegistrationRepository registrations;

    public BackupController(SettingsRepository settings, ReceiptService receipts, PaymentRepository payments,
                            MonthRepository months, RosterRepository roster,
                            RegistrationRepository registrations) {
        this.settings = settings;
        this.receipts = receipts;
        this.payments = payments;
        this.months = months;
        this.roster = roster;
        this.registrations = registrations;
    }

    @GetMapping
    public ResponseEntity<Backup> export() {
        Backup backup = new Backup(Backup.APP_ID, 4, Instant.now(), settings.get(), receipts.list(),
                payments.findAll(), months.findAll(), roster.raw(), registrations.get());
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"shalom-receipts-backup-" + LocalDate.now() + ".json\"")
                .body(backup);
    }

    @PostMapping("/restore")
    public Map<String, Integer> restore(@RequestBody Backup backup) {
        if (backup == null || !Backup.APP_ID.equals(backup.app())) {
            throw ApiException.badRequest("That file is not a valid backup.");
        }
        AppSettings s = backup.settings() == null ? AppSettings.defaults() : backup.settings();
        settings.save(s);
        Map<String, Integer> out = new LinkedHashMap<>();
        out.put("receipts", receipts.replaceAll(backup.receipts()));
        // only in backups made by this version; an older backup leaves these alone
        if (backup.students() != null && backup.students().get("students") != null) {
            roster.replaceRaw(backup.students());
            out.put("students", roster.load().students().size());
        }
        if (backup.payments() != null) {
            payments.replaceAll(backup.payments());
            out.put("payments", backup.payments().size());
        }
        if (backup.months() != null) {
            months.replaceAll(backup.months());
            out.put("months", backup.months().size());
        }
        if (backup.registrations() != null && backup.registrations().items() != null) {
            registrations.update(b -> backup.registrations());
            out.put("registrations", backup.registrations().items().size());
        }
        return out;
    }
}
