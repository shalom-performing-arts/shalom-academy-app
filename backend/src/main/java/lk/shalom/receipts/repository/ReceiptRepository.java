package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.Receipt;

import java.util.List;
import java.util.Optional;

/**
 * Where receipts are kept. Today that is a JSON file ({@link JsonReceiptRepository}); a database
 * implementation can replace it without touching the services or controllers.
 */
public interface ReceiptRepository {

    /** All receipts, newest first. */
    List<Receipt> findAll();

    Optional<Receipt> findById(String id);

    Optional<Receipt> findByNumber(String number);

    /** Inserts, or replaces the receipt with the same id. */
    Receipt save(Receipt receipt);

    boolean deleteById(String id);

    /** Returns how many receipts were removed. */
    int deleteAll();

    /** Replaces every receipt at once, as a backup restore does. */
    void replaceAll(List<Receipt> receipts);
}
