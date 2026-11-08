package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.AppSettings;

/** Where the academy settings are kept. */
public interface SettingsRepository {

    /** The saved settings, with defaults filled in for anything missing. */
    AppSettings get();

    AppSettings save(AppSettings settings);
}
