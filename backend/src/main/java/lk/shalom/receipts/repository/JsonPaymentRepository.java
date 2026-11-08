package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.Payment;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/** Keeps every payment in data/payments.json, held in memory and rewritten on each change. */
@Repository
@ConditionalOnProperty(name = "app.storage", havingValue = "json")
public class JsonPaymentRepository implements PaymentRepository {

    private final JsonFile<List<Payment>> file;
    private final List<Payment> payments;

    public JsonPaymentRepository(JsonMapper mapper, @Value("${app.data-dir}") String dataDir) {
        this.file = new JsonFile<>(mapper, Path.of(dataDir, "payments.json"), new TypeReference<>() {}, ArrayList::new);
        this.payments = new ArrayList<>(file.read());
    }

    @Override
    public synchronized List<Payment> findAll() {
        return List.copyOf(payments);
    }

    @Override
    public synchronized List<Payment> findByMonth(String month) {
        return payments.stream().filter(p -> Objects.equals(p.month(), month)).toList();
    }

    @Override
    public synchronized List<Payment> findByReceipt(String receiptId) {
        return payments.stream().filter(p -> receiptId != null && receiptId.equals(p.receiptId())).toList();
    }

    @Override
    public synchronized Optional<Payment> findById(String id) {
        return payments.stream().filter(p -> Objects.equals(p.id(), id)).findFirst();
    }

    @Override
    public synchronized Payment save(Payment payment) {
        int i = indexOf(payment.id());
        if (i >= 0) payments.set(i, payment); else payments.add(payment);
        file.write(payments);
        return payment;
    }

    @Override
    public synchronized boolean deleteById(String id) {
        boolean removed = payments.removeIf(p -> Objects.equals(p.id(), id));
        if (removed) file.write(payments);
        return removed;
    }

    @Override
    public synchronized void replaceAll(List<Payment> all) {
        payments.clear();
        payments.addAll(all);
        file.write(payments);
    }

    private int indexOf(String id) {
        for (int i = 0; i < payments.size(); i++) {
            if (Objects.equals(payments.get(i).id(), id)) return i;
        }
        return -1;
    }
}
