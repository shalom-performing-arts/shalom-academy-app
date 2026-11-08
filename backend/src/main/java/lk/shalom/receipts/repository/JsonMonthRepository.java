package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.MonthSheet;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.TreeMap;

/** All months in data/months.json, keyed by month. Small: one entry per student per month. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonMonthRepository implements MonthRepository {

    private final JsonFile<List<MonthSheet>> file;
    private final TreeMap<String, MonthSheet> months = new TreeMap<>();

    public JsonMonthRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "months.json"), new TypeReference<>() {}, ArrayList::new);
        for (MonthSheet m : file.read()) months.put(m.month(), m);
    }

    @Override
    public synchronized List<String> months() {
        return List.copyOf(months.keySet());
    }

    @Override
    public synchronized Optional<MonthSheet> find(String month) {
        return Optional.ofNullable(months.get(month));
    }

    @Override
    public synchronized MonthSheet save(MonthSheet sheet) {
        months.put(sheet.month(), sheet);
        file.write(new ArrayList<>(months.values()));
        return sheet;
    }

    @Override
    public synchronized List<MonthSheet> findAll() {
        return List.copyOf(months.values());
    }

    @Override
    public synchronized void replaceAll(List<MonthSheet> sheets) {
        months.clear();
        for (MonthSheet m : sheets) months.put(m.month(), m);
        file.write(new ArrayList<>(months.values()));
    }
}
