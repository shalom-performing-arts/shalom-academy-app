package lk.shalom.receipts.service;

import lk.shalom.receipts.model.Backup;
import lk.shalom.receipts.model.Receipt;
import lk.shalom.receipts.model.Receipt.LineItem;
import lk.shalom.receipts.model.Receipt.Person;
import lk.shalom.receipts.repository.JsonReceiptRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ReceiptServiceTest {

    @TempDir
    Path dir;

    JsonMapper mapper = JsonMapper.builder().build();
    ReceiptService service;

    @BeforeEach
    void setUp() {
        service = new ReceiptService(new JsonReceiptRepository(mapper, dir.toString()));
    }

    private static Receipt receipt(String number, BigDecimal... amounts) {
        List<LineItem> items = java.util.Arrays.stream(amounts)
                .map(a -> new LineItem("monthly", "November Class Fee", "", a)).toList();
        return new Receipt(null, number, "2026-11-03",
                List.of(new Person("Nimali Perera", "SAPA-1002", "Youth", "Guitar and Vocal", "Saturday", "9:30 AM", "Andante")),
                "Nimali Perera", "SAPA-1002", "Youth", "Guitar and Vocal", "Andante", "Saturday", "9:30 AM",
                "November", 2026, null, items, new BigDecimal("1"), "Cash", "Cash", "", "", "", null, null);
    }

    @Test
    void createAssignsIdAndRecomputesTotal() {
        Receipt saved = service.create(receipt("SAPA-1", new BigDecimal("3500"), new BigDecimal("1500.50")));

        assertThat(saved.id()).isNotBlank();
        assertThat(saved.total()).isEqualByComparingTo("5000.50");   // client said 1
        assertThat(saved.period()).isEqualTo("November 2026");
        assertThat(saved.createdAt()).isNotNull();
    }

    @Test
    void receiptsSurviveARestartOfTheRepository() {
        service.create(receipt("SAPA-1", new BigDecimal("3500")));

        ReceiptService reopened = new ReceiptService(new JsonReceiptRepository(mapper, dir.toString()));

        assertThat(reopened.list()).extracting(Receipt::number).containsExactly("SAPA-1");
    }

    @Test
    void aReceiptNumberCannotBeUsedTwice() {
        service.create(receipt("SAPA-1", new BigDecimal("3500")));

        assertThatThrownBy(() -> service.create(receipt("SAPA-1", new BigDecimal("100"))))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(HttpStatus.CONFLICT));
    }

    @Test
    void sendingOnWhatsAppIsRecordedAndSurvivesALaterEdit() {
        Receipt first = service.create(receipt("SAPA-1", new BigDecimal("3500")));

        Receipt sent = service.markSent(first.id(), "+94 71 040 7740");
        Receipt edited = service.update(first.id(), receipt("SAPA-1", new BigDecimal("4000")));

        assertThat(sent.sentTo()).isEqualTo("94710407740");
        assertThat(sent.sentAt()).isNotNull();
        assertThat(edited.sentAt()).isEqualTo(sent.sentAt());    // the form never sends it back
        assertThat(edited.sentTo()).isEqualTo("94710407740");
        assertThatThrownBy(() -> service.markSent(first.id(), "071"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void updatingKeepsTheIdAndCreationTime() {
        Receipt first = service.create(receipt("SAPA-1", new BigDecimal("3500")));

        Receipt second = service.update(first.id(), receipt("SAPA-1", new BigDecimal("4000")));

        assertThat(second.id()).isEqualTo(first.id());
        assertThat(second.createdAt()).isEqualTo(first.createdAt());
        assertThat(second.total()).isEqualByComparingTo("4000");
        assertThat(service.list()).hasSize(1);
    }

    @Test
    void aReceiptWithoutFeesIsRejected() {
        assertThatThrownBy(() -> service.create(receipt("SAPA-1")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void monthlyTotalsGroupByFeeMonth() {
        service.create(receipt("SAPA-1", new BigDecimal("3500")));
        service.create(receipt("SAPA-2", new BigDecimal("1500")));

        assertThat(service.monthlyTotals()).singleElement().satisfies(m -> {
            assertThat(m.period()).isEqualTo("November 2026");
            assertThat(m.receipts()).isEqualTo(2);
            assertThat(m.total()).isEqualByComparingTo("5000");
        });
    }

    /** A backup exported by the original browser app stores the year as a string. */
    @Test
    void restoresABackupFromTheBrowserApp() {
        String json = """
                {"app":"shalom-fee-receipts","version":2,"exportedAt":"2026-10-20T10:00:00.000Z",
                 "settings":{"academyName":"Shalom Academy of Performing Arts","footerReset":true},
                 "roster":[{"name":"ignored"}],
                 "receipts":[{"id":"rabc123","number":"SAPA-20261020-154654","date":"2026-10-20",
                   "student":"Nimali Perera","cls":"Guitar and Vocal","month":"October","year":"2026",
                   "period":"October 2026","items":[{"kind":"monthly","desc":"October Class Fee","sub":"","amount":3500}],
                   "total":3500,"method":"Cash","createdAt":"2026-10-20T10:46:54.000Z"}]}
                """;
        Backup backup = mapper.readValue(json, Backup.class);

        assertThat(service.replaceAll(backup.receipts())).isEqualTo(1);
        Receipt r = service.get("rabc123");
        assertThat(r.year()).isEqualTo(2026);
        assertThat(r.total()).isEqualByComparingTo("3500");
    }

    @Test
    void csvHasAHeaderAndOneRowPerReceipt() {
        service.create(receipt("SAPA-1", new BigDecimal("3500")));

        String[] lines = service.csv().split("\r\n");

        assertThat(lines).hasSize(2);
        assertThat(lines[0]).startsWith("﻿\"Receipt No\"");
        assertThat(lines[1]).contains("\"SAPA-1\"", "\"3500.00\"", "November Class Fee = 3,500.00");
    }
}
