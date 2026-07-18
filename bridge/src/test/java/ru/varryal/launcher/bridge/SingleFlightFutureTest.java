package ru.varryal.launcher.bridge;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SingleFlightFutureTest {

    @Test
    void sharesOneSuccessfulFutureAcrossAllCallers() {
        var calls = new AtomicInteger();
        var pending = new CompletableFuture<String>();
        var once = new SingleFlightFuture<>(() -> {
            calls.incrementAndGet();
            return pending;
        });

        var first = once.get();
        var second = once.get();
        pending.complete("ready");

        assertSame(first, second);
        assertEquals("ready", first.join());
        assertSame(first, once.get());
        assertEquals(1, calls.get());
    }

    @Test
    void cachesSynchronousFailureFromTheOperationFactory() {
        var calls = new AtomicInteger();
        var once = new SingleFlightFuture<String>(() -> {
            calls.incrementAndGet();
            throw new IllegalStateException("sync init failure");
        });

        assertThrows(RuntimeException.class, () -> once.get().join());
        assertThrows(RuntimeException.class, () -> once.get().join());
        assertEquals(1, calls.get());
    }

    @Test
    void cachesFailureBecauseTheBackendInitOperationIsNotRetrySafe() {
        var calls = new AtomicInteger();
        var once = new SingleFlightFuture<String>(() -> {
            calls.incrementAndGet();
            return CompletableFuture.failedFuture(new IllegalStateException("init failed"));
        });

        var first = once.get();
        var second = once.get();

        assertSame(first, second);
        assertThrows(RuntimeException.class, first::join);
        assertEquals(1, calls.get());
    }
}
