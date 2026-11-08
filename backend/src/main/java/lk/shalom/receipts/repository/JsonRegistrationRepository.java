package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.RegistrationBook;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.util.function.UnaryOperator;

/** Online registrations and the public form's settings, in data/registrations.json. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonRegistrationRepository implements RegistrationRepository {

    private final JsonFile<RegistrationBook> file;
    private RegistrationBook current;

    public JsonRegistrationRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "registrations.json"), new TypeReference<>() {},
                RegistrationBook::empty);
        RegistrationBook read = file.read();
        this.current = read.clean(newToken());
        if (read.form() == null || read.form().token() == null) file.write(current);   // keep the link once made
    }

    @Override
    public synchronized RegistrationBook get() {
        return current;
    }

    /** One change at a time, so two parents submitting together cannot overwrite each other. */
    @Override
    public synchronized RegistrationBook update(UnaryOperator<RegistrationBook> change) {
        current = change.apply(current).clean(newToken());
        file.write(current);
        return current;
    }

    public static String newToken() {
        return RegistrationRepository.newToken();
    }
}
