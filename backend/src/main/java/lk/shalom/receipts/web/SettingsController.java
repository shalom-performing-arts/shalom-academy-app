package lk.shalom.receipts.web;

import lk.shalom.receipts.model.AppSettings;
import lk.shalom.receipts.repository.SettingsRepository;
import lk.shalom.receipts.service.MonthService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class SettingsController {

    private final SettingsRepository settings;
    private final MonthService months;

    public SettingsController(SettingsRepository settings, MonthService months) {
        this.settings = settings;
        this.months = months;
    }

    @GetMapping("/settings")
    public AppSettings getSettings() {
        return settings.get();
    }

    @PutMapping("/settings")
    public AppSettings saveSettings(@RequestBody AppSettings incoming) {
        AppSettings before = settings.get();
        AppSettings saved = settings.save(incoming);
        // the sibling discount changes what the newest month asks of unpaid students
        if (!saved.siblingDiscount().equals(before.siblingDiscount())) months.syncNewest();
        return saved;
    }
}
