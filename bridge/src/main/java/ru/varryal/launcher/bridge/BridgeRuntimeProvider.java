package ru.varryal.launcher.bridge;

import pro.gravit.launcher.core.backend.LauncherBackendAPI;
import pro.gravit.launcher.core.backend.LauncherBackendAPIHolder;
import pro.gravit.launcher.runtime.gui.RuntimeProvider;

import java.util.concurrent.CountDownLatch;

/**
 * Implements the GUI SPI RuntimeProvider.
 * Instead of Application.launch() (JavaFX), starts an embedded WebSocket server
 * and bridges LauncherBackendAPI to the Tauri shell / React UI.
 */
public class BridgeRuntimeProvider implements RuntimeProvider {

    private WsBridgeServer wsServer;
    private final CountDownLatch shutdownLatch = new CountDownLatch(1);

    @Override
    public void preLoad() {
        System.out.println("[VarryalBridge] preLoad()");
    }

    @Override
    public void init(boolean clientInstance) {
        System.out.println("[VarryalBridge] init(clientInstance=" + clientInstance + ")");
    }

    @Override
    public void run(String[] args) {
        System.out.println("[VarryalBridge] run() — starting WS bridge");

        // Guard-relaunch check: the WS server should start in the FINAL (wrapped) JVM.
        // ClientLauncherWrapper sets launcher.wrappedLaunch=true when it re-spawns.
        // If -Dlauncher.noJavaCheck=true is set, no relaunch happens — proceed directly.
        String wrappedLaunch = System.getProperty("launcher.wrappedLaunch");
        boolean noJavaCheck = "true".equals(System.getProperty("launcher.noJavaCheck"));
        if (!"true".equals(wrappedLaunch) && !noJavaCheck) {
            System.out.println("[VarryalBridge] Pre-guard JVM — waiting for guard relaunch.");
            try { shutdownLatch.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            return;
        }

        // Obtain the backend facade
        LauncherBackendAPI api = LauncherBackendAPIHolder.getApi();
        if (api == null) {
            System.err.println("[VarryalBridge] FATAL: LauncherBackendAPI is null — aborting");
            return;
        }

        // Determine port (system property > random)
        int port = 0;
        try {
            String portProp = System.getProperty("varryal.ipc.port");
            if (portProp != null) port = Integer.parseInt(portProp);
        } catch (NumberFormatException ignored) {}

        // Start embedded WS server
        try {
            wsServer = new WsBridgeServer(port, api, shutdownLatch);
            wsServer.start();
        } catch (Exception e) {
            System.err.println("[VarryalBridge] Failed to start WS server: " + e.getMessage());
            e.printStackTrace();
            return;
        }

        // Block until shutdown is requested
        try { shutdownLatch.await(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }

        // Graceful WS shutdown
        if (wsServer != null) {
            try { wsServer.stop(1000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        System.out.println("[VarryalBridge] Bridge shut down.");
    }

    public void triggerShutdown() {
        shutdownLatch.countDown();
    }
}
