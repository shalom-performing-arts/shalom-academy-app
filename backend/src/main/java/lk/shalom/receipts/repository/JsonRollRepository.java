package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.RollBook;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.util.function.UnaryOperator;

/** Student attendance in data/student-attendance.json. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonRollRepository implements RollRepository {

    private final JsonFile<RollBook> file;
    private RollBook current;

    public JsonRollRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "student-attendance.json"), new TypeReference<>() {}, RollBook::empty);
        this.current = file.read().clean();
    }

    @Override
    public synchronized RollBook get() {
        return current;
    }

    /** One change at a time, so three teachers marking the same class cannot overwrite each other. */
    @Override
    public synchronized RollBook update(UnaryOperator<RollBook> change) {
        current = change.apply(current).clean();
        file.write(current);
        return current;
    }
}
