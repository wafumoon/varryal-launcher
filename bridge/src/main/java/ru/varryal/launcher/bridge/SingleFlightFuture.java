package ru.varryal.launcher.bridge;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

/**
 * Starts a non-idempotent asynchronous operation at most once for this object lifetime.
 * Both success and failure are cached: retrying a partially completed backend init is unsafe.
 */
final class SingleFlightFuture<T> {
    private final Supplier<CompletableFuture<T>> operation;
    private CompletableFuture<T> future;

    SingleFlightFuture(Supplier<CompletableFuture<T>> operation) {
        this.operation = Objects.requireNonNull(operation, "operation");
    }

    synchronized CompletableFuture<T> get() {
        if (future == null) {
            try {
                future = Objects.requireNonNull(operation.get(), "operation returned null future");
            } catch (Throwable error) {
                future = CompletableFuture.failedFuture(error);
            }
        }
        return future;
    }
}
