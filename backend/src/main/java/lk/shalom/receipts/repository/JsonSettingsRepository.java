package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.AppSettings;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;

/** Keeps the settings in data/settings.json. A missing file simply means "all defaults". */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonSettingsRepository implements SettingsRepository {

    private final JsonFile<AppSettings> file;
    private AppSettings current;

    public JsonSettingsRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "settings.json"),
                new TypeReference<>() {}, AppSettings::defaults);
        this.current = file.read().withDefaults();
    }

    @Override
    public synchronized AppSettings get() {
        return current;
    }

    @Override
    public synchronized AppSettings save(AppSettings settings) {
        current = settings.withDefaults();
        file.write(current);
        return current;
    }
}
