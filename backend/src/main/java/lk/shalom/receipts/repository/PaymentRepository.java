package lk.shalom.receipts.repository;

import lk.shalom.receipts.model.Payment;

import java.util.List;
import java.util.Optional;

/** Where payments are kept. */
public interface PaymentRepository {

    List<Payment> findAll();

    List<Payment> findByMonth(String month);

    List<Payment> findByReceipt(String receiptId);

    Optional<Payment> findById(String id);

    Payment save(Payment payment);

    boolean deleteById(String id);

    void replaceAll(List<Payment> payments);
}
