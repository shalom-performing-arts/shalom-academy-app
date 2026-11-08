package lk.shalom.receipts.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

/**
 * Academy details, receipt options and the lists the app lets people edit, shared by every
 * device that uses the app.
 *
 * <p>{@code logo} and {@code signature} are optional data-URI overrides. Left blank, the
 * frontend uses logo.png and signature.png from its own folder.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AppSettings(
        String academyName,
        String tagline,
        String motto,
        String address,
        String phone,
        String whatsapp,
        String email,
        String logo,
        String signature,
        String signName,
        String signTitle,
        String signStyle,       // "typed" = name set in script, "image" = uploaded signature
        String prefix,
        String numFormat,       // "datetime" | "compact" | "epoch"
        String currency,
        String currencyWord,
        String theme,           // "monthly" | "classic"
        List<ClassFee> classes, // the courses printed on receipts: "Guitar and Vocal"
        BigDecimal admissionFee, // kept for older settings files; the admission fee type holds it now
        String footer,
        List<String> paidToOptions,      // where money can go: the bank accounts and "Cash"
        List<String> paymentMethods,     // how it was paid: Bank Transfer, Cash, Cheque …
        List<FeeType> feeTypes,          // what a payment can be for: Monthly fee, Admission fee, Exam fee …
        SiblingDiscount siblingDiscount,
        List<StudentField> studentFields, // extra details kept for each student
        String countryCode,              // added to local numbers for WhatsApp: 0710407740 → 94710407740
        String whatsappMessage           // sent with the receipt; {parent} {student} {period} {total} {number} {academy}
) {

    public static final String DEFAULT_COUNTRY_CODE = "94";
    public static final String DEFAULT_WHATSAPP_MESSAGE =
            "Dear {parent},\n\nThank you for the payment of Rs. {total} for {student} ({period}). "
            + "Your receipt {number} is attached.\n\n{academy}";

    public AppSettings(String academyName, String tagline, String motto, String address, String phone,
                       String whatsapp, String email, String logo, String signature, String signName,
                       String signTitle, String signStyle, String prefix, String numFormat, String currency,
                       String currencyWord, String theme, List<ClassFee> classes, BigDecimal admissionFee,
                       String footer, List<String> paidToOptions, List<String> paymentMethods,
                       List<FeeType> feeTypes, SiblingDiscount siblingDiscount, List<StudentField> studentFields) {
        this(academyName, tagline, motto, address, phone, whatsapp, email, logo, signature, signName, signTitle,
                signStyle, prefix, numFormat, currency, currencyWord, theme, classes, admissionFee, footer,
                paidToOptions, paymentMethods, feeTypes, siblingDiscount, studentFields, null, null);
    }

    public static final List<String> DEFAULT_PAID_TO = List.of("Shalom Academy", "Rebeccah Nayomi", "Cash");
    public static final List<String> DEFAULT_METHODS = List.of("Bank Transfer", "Online Payment", "Cash", "Cheque", "Card");

    /** The two fee types the app itself relies on. They can be renamed but not removed. */
    public static final String MONTHLY = "monthly";
    public static final String ADMISSION = "admission";

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ClassFee(String name, BigDecimal fee) {}

    /**
     * Something a payment can be for.
     *
     * @param id            stable key stored on payments; "monthly" and "admission" are built in
     * @param defaultAmount filled in when this type is picked; null = type it each time
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record FeeType(String id, String name, BigDecimal defaultAmount) {}

    /**
     * Off by default. When on, the second and later children of a family each get
     * {@code value} off (a percentage, or a fixed amount), unless they are on a special fee.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SiblingDiscount(boolean enabled, String type, BigDecimal value) {
        public static final String PERCENT = "percent";
        public static final String AMOUNT = "amount";
    }

    /**
     * An extra detail kept for every student, such as their school or date of birth.
     *
     * @param type   text, number, date, phone or select
     * @param inList also shown on the Students page rows
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record StudentField(String key, String label, String type, List<String> options, boolean inList) {}

    public static AppSettings defaults() {
        return new AppSettings(
                "Shalom Academy of Performing Arts",
                "",
                "Where Music Truly Comes to Life for Children.",
                "",
                "",
                "0706 333 778",
                "",
                "",
                "",
                "Rebeccah Shalom",
                "Authorised Signature",
                "typed",
                "SAPA",
                "datetime",
                "LKR",
                "Rupees",
                "monthly",
                List.of(new ClassFee("Guitar and Vocal", BigDecimal.ZERO),
                        new ClassFee("Ukulele and Vocal", BigDecimal.ZERO)),
                BigDecimal.ZERO,
                "Thank you so much for your support and trust! ❤️",
                DEFAULT_PAID_TO,
                DEFAULT_METHODS,
                List.of(new FeeType(MONTHLY, "Monthly fee", null), new FeeType(ADMISSION, "Admission fee", null)),
                new SiblingDiscount(false, SiblingDiscount.PERCENT, BigDecimal.ZERO),
                List.of(),
                DEFAULT_COUNTRY_CODE,
                DEFAULT_WHATSAPP_MESSAGE
        );
    }

    /**
     * Fills anything missing from the defaults, so a settings file written by an older version
     * (or a partial backup) still yields a complete set. Blank strings are kept: clearing a
     * field such as the address is a real choice.
     */
    public AppSettings withDefaults() {
        AppSettings d = defaults();
        List<ClassFee> cls = classes == null ? List.of() : classes.stream()
                .filter(c -> c != null && c.name() != null && !c.name().isBlank())
                .map(c -> new ClassFee(c.name().trim(), c.fee() == null ? BigDecimal.ZERO : c.fee()))
                .toList();
        BigDecimal admission = admissionFee == null || admissionFee.signum() < 0 ? BigDecimal.ZERO : admissionFee;
        return new AppSettings(
                isBlank(academyName) ? d.academyName : academyName.trim(),
                Objects.requireNonNullElse(tagline, d.tagline),
                Objects.requireNonNullElse(motto, d.motto),
                Objects.requireNonNullElse(address, d.address),
                Objects.requireNonNullElse(phone, d.phone),
                Objects.requireNonNullElse(whatsapp, d.whatsapp),
                Objects.requireNonNullElse(email, d.email),
                Objects.requireNonNullElse(logo, d.logo),
                Objects.requireNonNullElse(signature, d.signature),
                Objects.requireNonNullElse(signName, d.signName),
                Objects.requireNonNullElse(signTitle, d.signTitle),
                "image".equals(signStyle) ? "image" : "typed",
                Objects.requireNonNullElse(prefix, d.prefix),
                isBlank(numFormat) ? d.numFormat : numFormat,
                isBlank(currency) ? d.currency : currency,
                isBlank(currencyWord) ? d.currencyWord : currencyWord,
                "classic".equals(theme) ? "classic" : "monthly",
                cls.isEmpty() ? d.classes : cls,
                admission,
                Objects.requireNonNullElse(footer, d.footer),
                cleanList(paidToOptions, DEFAULT_PAID_TO),
                cleanList(paymentMethods, DEFAULT_METHODS),
                cleanFeeTypes(feeTypes, admission),
                cleanDiscount(siblingDiscount),
                cleanFields(studentFields),
                countryCode == null || countryCode.replaceAll("[^0-9]", "").isEmpty()
                        ? d.countryCode : countryCode.replaceAll("[^0-9]", ""),
                isBlank(whatsappMessage) ? d.whatsappMessage : whatsappMessage
        );
    }

    /** Trimmed, no blanks or repeats; the defaults when nothing is left. */
    private static List<String> cleanList(List<String> in, List<String> fallback) {
        if (in == null) return fallback;
        List<String> out = in.stream().filter(s -> s != null && !s.isBlank()).map(String::trim).distinct().toList();
        return out.isEmpty() ? fallback : out;
    }

    /** Monthly first, admission second, then the rest, each with a unique id. */
    private static List<FeeType> cleanFeeTypes(List<FeeType> in, BigDecimal admissionFee) {
        List<FeeType> list = in == null ? List.of() : in.stream().filter(Objects::nonNull).toList();
        FeeType monthly = list.stream().filter(t -> MONTHLY.equals(t.id())).findFirst()
                .orElse(new FeeType(MONTHLY, "Monthly fee", null));
        FeeType admission = list.stream().filter(t -> ADMISSION.equals(t.id())).findFirst()
                .orElse(new FeeType(ADMISSION, "Admission fee",
                        admissionFee != null && admissionFee.signum() > 0 ? admissionFee : null));
        List<FeeType> out = new ArrayList<>();
        out.add(new FeeType(MONTHLY, nameOr(monthly.name(), "Monthly fee"), null));   // the month's fee says what it is
        out.add(new FeeType(ADMISSION, nameOr(admission.name(), "Admission fee"), positive(admission.defaultAmount())));
        Set<String> ids = new HashSet<>(List.of(MONTHLY, ADMISSION, "other"));
        for (FeeType t : list) {
            if (MONTHLY.equals(t.id()) || ADMISSION.equals(t.id()) || isBlank(t.name())) continue;
            String id = isBlank(t.id()) ? slug(t.name()) : t.id().trim();
            String unique = id;
            for (int n = 2; !ids.add(unique); n++) unique = id + "-" + n;
            out.add(new FeeType(unique, t.name().trim(), positive(t.defaultAmount())));
        }
        return out;
    }

    private static SiblingDiscount cleanDiscount(SiblingDiscount d) {
        if (d == null) return new SiblingDiscount(false, SiblingDiscount.PERCENT, BigDecimal.ZERO);
        String type = SiblingDiscount.AMOUNT.equals(d.type()) ? SiblingDiscount.AMOUNT : SiblingDiscount.PERCENT;
        BigDecimal v = d.value() == null || d.value().signum() < 0 ? BigDecimal.ZERO : d.value();
        if (SiblingDiscount.PERCENT.equals(type) && v.compareTo(BigDecimal.valueOf(100)) > 0) v = BigDecimal.valueOf(100);
        return new SiblingDiscount(d.enabled(), type, v);
    }

    private static List<StudentField> cleanFields(List<StudentField> in) {
        if (in == null) return List.of();
        Set<String> keys = new HashSet<>();
        List<StudentField> out = new ArrayList<>();
        for (StudentField f : in) {
            if (f == null || isBlank(f.label())) continue;
            String key = isBlank(f.key()) ? slug(f.label()) : f.key().trim();
            String unique = key;
            for (int n = 2; !keys.add(unique); n++) unique = key + "-" + n;
            String type = List.of("text", "number", "date", "phone", "select").contains(f.type()) ? f.type() : "text";
            List<String> options = "select".equals(type) ? cleanList(f.options(), List.of()) : List.of();
            out.add(new StudentField(unique, f.label().trim(), type, options, f.inList()));
        }
        return out;
    }

    /** "Exam fee (Grade 1)" → "exam-fee-grade-1" */
    public static String slug(String s) {
        String out = s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("(^-|-$)", "");
        return out.isEmpty() ? "item" : out;
    }

    /** The first option is where money goes unless said otherwise, as in the workbook. */
    public String defaultPaidTo() {
        return cleanList(paidToOptions, DEFAULT_PAID_TO).getFirst();
    }

    public boolean isFeeType(String id) {
        return id != null && feeTypes != null && feeTypes.stream().anyMatch(t -> id.equals(t.id()));
    }

    private static String nameOr(String s, String fallback) {
        return isBlank(s) ? fallback : s.trim();
    }

    private static BigDecimal positive(BigDecimal b) {
        return b != null && b.signum() > 0 ? b : null;
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
