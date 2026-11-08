package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.Receipt;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/** Keeps every receipt in data/receipts.json, held in memory and rewritten on each change. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonReceiptRepository implements ReceiptRepository {

    private static final Comparator<Receipt> NEWEST_FIRST = Comparator
            .comparing(Receipt::createdAt, Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(Receipt::number, Comparator.nullsLast(Comparator.reverseOrder()));

    private final JsonFile<List<Receipt>> file;
    private final List<Receipt> receipts;

    public JsonReceiptRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "receipts.json"),
                new TypeReference<>() {}, ArrayList::new);
        this.receipts = new ArrayList<>(file.read());
        this.receipts.sort(NEWEST_FIRST);
    }

    @Override
    public synchronized List<Receipt> findAll() {
        return List.copyOf(receipts);
    }

    @Override
    public synchronized Optional<Receipt> findById(String id) {
        return receipts.stream().filter(r -> Objects.equals(r.id(), id)).findFirst();
    }

    @Override
    public synchronized Optional<Receipt> findByNumber(String number) {
        return receipts.stream().filter(r -> Objects.equals(r.number(), number)).findFirst();
    }

    @Override
    public synchronized Receipt save(Receipt receipt) {
        receipts.removeIf(r -> Objects.equals(r.id(), receipt.id()));
        receipts.add(receipt);
        receipts.sort(NEWEST_FIRST);
        file.write(receipts);
        return receipt;
    }

    @Override
    public synchronized boolean deleteById(String id) {
        boolean removed = receipts.removeIf(r -> Objects.equals(r.id(), id));
        if (removed) {
            file.write(receipts);
        }
        return removed;
    }

    @Override
    public synchronized int deleteAll() {
        int n = receipts.size();
        receipts.clear();
        file.write(receipts);
        return n;
    }

    @Override
    public synchronized void replaceAll(List<Receipt> all) {
        receipts.clear();
        receipts.addAll(all);
        receipts.sort(NEWEST_FIRST);
        file.write(receipts);
    }
}
