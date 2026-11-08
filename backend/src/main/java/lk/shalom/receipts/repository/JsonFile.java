package lk.shalom.receipts.repository;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.function.Supplier;

/**
 * Reads and writes one JSON file.
 *
 * <p>Writes go to a temporary file first and are then moved over the real one, so a crash or
 * power cut mid-write leaves the previous version intact rather than half a file.
 */
final class JsonFile<T> {

    private final JsonMapper mapper;
    private final Path path;
    private final TypeReference<T> type;
    private final Supplier<T> empty;

    JsonFile(JsonMapper mapper, Path path, TypeReference<T> type, Supplier<T> empty) {
        this.mapper = mapper;
        this.path = path;
        this.type = type;
        this.empty = empty;
    }

    Path path() {
        return path;
    }

    T read() {
        if (!Files.exists(path)) {
            return empty.get();
        }
        try {
            if (Files.size(path) == 0) {
                return empty.get();
            }
            return mapper.readValue(path.toFile(), type);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read " + path, e);
        }
    }

    void write(T value) {
        try {
            Files.createDirectories(path.toAbsolutePath().getParent());
            Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
            mapper.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), value);
            try {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Could not write " + path, e);
        }
    }
}
