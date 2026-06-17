package ru.varryal.launcher.bridge;

import com.google.gson.JsonObject;
import pro.gravit.launcher.core.backend.LauncherBackendAPI;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;

/**
 * Bridges LauncherBackendAPI.RunCallback to WebSocket events on channel "run".
 * RunCallback is a class — we extend it.
 * Console output is base64-encoded to safely carry arbitrary bytes over JSON.
 */
public class WsRunCallback extends LauncherBackendAPI.RunCallback {

    private final WsBridgeServer server;
    private final String readyProfileId;
    private final Map<String, Runnable> terminateRunnables;
    /** Game stdout+stderr are mirrored here so users (and us) can grab a crash/launch log. */
    private final OutputStream gameLog;

    public WsRunCallback(WsBridgeServer server, String readyProfileId, Map<String, Runnable> terminateRunnables) {
        this.server = server;
        this.readyProfileId = readyProfileId;
        this.terminateRunnables = terminateRunnables;
        this.gameLog = openGameLog();
    }

    /** Open %APPDATA%/Varryal/logs/game-latest.log (truncate per run); null on failure (non-fatal). */
    private static OutputStream openGameLog() {
        try {
            String appdata = System.getenv("APPDATA");
            File base = (appdata != null && !appdata.isBlank()) ? new File(appdata) : new File(System.getProperty("user.home"));
            File dir = new File(base, "Varryal" + File.separator + "logs");
            dir.mkdirs();
            return new FileOutputStream(new File(dir, "game-latest.log"), false);
        } catch (Exception e) {
            return null;
        }
    }

    private synchronized void appendGameLog(byte[] buf, int off, int len) {
        if (gameLog == null) return;
        try { gameLog.write(buf, off, len); gameLog.flush(); } catch (Exception ignored) {}
    }

    private synchronized void closeGameLog() {
        if (gameLog == null) return;
        try { gameLog.close(); } catch (Exception ignored) {}
    }

    @Override
    public void onStarted() {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        server.broadcastEvent("run", "onStarted", data);
    }

    @Override
    public void onCanTerminate(Runnable terminate) {
        // Gravit passes null to clear the terminate handler when the process ends.
        // ConcurrentHashMap.put(key, null) throws a (message-less) NPE, so remove
        // the entry instead of storing null.
        if (terminate == null) {
            terminateRunnables.remove(readyProfileId);
            return;
        }
        terminateRunnables.put(readyProfileId, terminate);
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        server.broadcastEvent("run", "onCanTerminate", data);
    }

    @Override
    public void onNormalOutput(byte[] buf, int off, int len) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        byte[] slice = (off == 0 && len == buf.length) ? buf : Arrays.copyOfRange(buf, off, off + len);
        data.addProperty("base64", Base64.getEncoder().encodeToString(slice));
        server.broadcastEvent("run", "onNormalOutput", data);
        appendGameLog(buf, off, len);
    }

    @Override
    public void onErrorOutput(byte[] buf, int off, int len) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        byte[] slice = (off == 0 && len == buf.length) ? buf : Arrays.copyOfRange(buf, off, off + len);
        data.addProperty("base64", Base64.getEncoder().encodeToString(slice));
        server.broadcastEvent("run", "onErrorOutput", data);
        appendGameLog(buf, off, len);
    }

    @Override
    public void onFinished(int code) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        data.addProperty("code", code);
        server.broadcastEvent("run", "onFinished", data);
        closeGameLog();
    }

    @Override
    public void onReadyToExit() {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        server.broadcastEvent("run", "onReadyToExit", data);
    }
}
