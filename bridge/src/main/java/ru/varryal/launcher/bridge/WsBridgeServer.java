package ru.varryal.launcher.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import pro.gravit.launcher.core.backend.LauncherBackendAPI;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.concurrent.CountDownLatch;

/**
 * Embedded WebSocket server (using java-websocket library).
 * Binds strictly to 127.0.0.1 on a random high port.
 * Writes ipc-handshake.json and prints VARRYAL_IPC line for the Rust shell.
 */
public class WsBridgeServer extends WebSocketServer {

    static final Gson GSON = new GsonBuilder().create();

    private final String sessionToken;
    private final IpcDispatcher dispatcher;
    // boundPort is only known after onStart() fires (the OS assigns the port on bind).
    // We use a latch so callers can wait until onStart() has run.
    private volatile int boundPort = 0;
    private final CountDownLatch startLatch = new CountDownLatch(1);

    public WsBridgeServer(int preferredPort, LauncherBackendAPI api, CountDownLatch shutdownLatch) throws IOException {
        // Port 0 → OS picks a free port; it is only known after bind (inside start()).
        super(new InetSocketAddress("127.0.0.1", preferredPort == 0 ? 0 : preferredPort));
        this.sessionToken = generateToken();
        this.dispatcher = new IpcDispatcher(api, this, sessionToken, shutdownLatch);

        setReuseAddr(false);
        setConnectionLostTimeout(60);
        // Handshake is written in onStart(), after the port is actually bound.
    }

    /**
     * Block until the server has bound its port and written the handshake.
     * Must be called after start(). Throws if the server fails to start within 10 s.
     */
    public void awaitStart() throws InterruptedException {
        if (!startLatch.await(10, java.util.concurrent.TimeUnit.SECONDS)) {
            throw new IllegalStateException("WsBridgeServer did not start within 10 seconds");
        }
    }

    // ── WebSocketServer callbacks ─────────────────────────────────────────────

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        System.out.println("[VarryalBridge] WS client connected: " + conn.getRemoteSocketAddress());
        dispatcher.onClientConnected(conn);
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        System.out.println("[VarryalBridge] WS client disconnected: code=" + code + " reason=" + reason);
        dispatcher.onClientDisconnected(conn);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        dispatcher.handleMessage(conn, message);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        System.err.println("[VarryalBridge] WS error on " + (conn != null ? conn.getRemoteSocketAddress() : "server") + ": " + ex.getMessage());
    }

    @Override
    public void onStart() {
        // getPort() now returns the real bound port (assigned by OS when preferredPort was 0).
        this.boundPort = getPort();
        System.out.println("[VarryalBridge] WebSocket server listening on ws://127.0.0.1:" + boundPort);
        writeHandshake();
        printHandshakeSignal();
        startLatch.countDown();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    public int getBoundPort() {
        return boundPort;
    }

    public String getSessionToken() {
        return sessionToken;
    }

    /**
     * Broadcast an event to all connected clients.
     */
    public void broadcastEvent(String channel, String name, JsonObject data) {
        JsonObject evt = new JsonObject();
        evt.addProperty("type", "event");
        evt.addProperty("channel", channel);
        evt.addProperty("name", name);
        evt.addProperty("token", sessionToken);
        evt.add("data", data);
        String json = GSON.toJson(evt);
        broadcast(json);
    }

    private static int findFreePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0)) {
            return s.getLocalPort();
        }
    }

    private static String generateToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    private void writeHandshake() {
        try {
            String dataDir = System.getenv("APPDATA");
            if (dataDir == null) dataDir = System.getProperty("user.home");
            Path dir = Paths.get(dataDir, "Varryal");
            Files.createDirectories(dir);
            Path file = dir.resolve("ipc-handshake.json");
            JsonObject obj = new JsonObject();
            obj.addProperty("port", boundPort);
            obj.addProperty("token", sessionToken);
            obj.addProperty("pid", ProcessHandle.current().pid());
            obj.addProperty("protocolVersion", 1);
            Files.writeString(file, GSON.toJson(obj));
            System.out.println("[VarryalBridge] Handshake written to: " + file);
        } catch (IOException e) {
            System.err.println("[VarryalBridge] Warning: could not write ipc-handshake.json: " + e.getMessage());
        }
    }

    private void printHandshakeSignal() {
        // Rust reads this line from stdout to discover port and token without polling a file.
        System.out.flush();
        System.out.println("VARRYAL_IPC port=" + boundPort + " token=" + sessionToken);
        System.out.flush();
    }
}
