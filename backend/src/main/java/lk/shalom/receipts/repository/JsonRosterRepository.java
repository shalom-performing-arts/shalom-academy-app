package lk.shalom.receipts.repository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Keeps the roster in data/students.json. The file carries more than this app manages (ages,
 * songs, adjudication results); records are edited in place, so those are written back untouched.
 * Used when {@code app.storage=json}, and to import the file into the database.
 */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonRosterRepository extends AbstractRosterRepository {

    private final JsonFile<Map<String, Object>> file;

    public JsonRosterRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "students.json"),
                new TypeReference<>() {}, LinkedHashMap::new);
    }

    @Override
    protected Map<String, Object> readRaw() {
        return file.read();
    }

    @Override
    protected void writeRaw(Map<String, Object> raw) {
        file.write(raw);
    }
}
