package lk.shalom.receipts.repository.pg;

import lk.shalom.receipts.model.AppSettings;
import lk.shalom.receipts.repository.SettingsRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

import java.util.List;

/** The settings: one row in the settings table, kept as a JSON document. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "postgres", matchIfMissing = true)
public class PgSettingsRepository implements SettingsRepository {

    private final Db db;
    private AppSettings current;

    public PgSettingsRepository(Db db) {
        this.db = db;
    }

    @Override
    public synchronized AppSettings get() {
        if (current == null) {
            List<String> rows = db.jdbc.queryForList("select data::text from settings where id = 1", String.class);
            current = rows.isEmpty() ? AppSettings.defaults() : db.fromJson(rows.getFirst(), AppSettings.class).withDefaults();
        }
        return current;
    }

    @Override
    public synchronized AppSettings save(AppSettings settings) {
        AppSettings s = settings.withDefaults();
        db.jdbc.update("""
                insert into settings (id, data, updated_at) values (1, ?::jsonb, now())
                on conflict (id) do update set data = excluded.data, updated_at = now()""", db.toJson(s));
        current = s;
        return s;
    }
}
