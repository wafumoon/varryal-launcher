package ru.varryal.launcher.bridge;

import com.google.gson.JsonObject;
import pro.gravit.launcher.core.backend.LauncherBackendAPI;

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

    public WsRunCallback(WsBridgeServer server, String readyProfileId, Map<String, Runnable> terminateRunnables) {
        this.server = server;
        this.readyProfileId = readyProfileId;
        this.terminateRunnables = terminateRunnables;
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
    }

    @Override
    public void onErrorOutput(byte[] buf, int off, int len) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        byte[] slice = (off == 0 && len == buf.length) ? buf : Arrays.copyOfRange(buf, off, off + len);
        data.addProperty("base64", Base64.getEncoder().encodeToString(slice));
        server.broadcastEvent("run", "onErrorOutput", data);
    }

    @Override
    public void onFinished(int code) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        data.addProperty("code", code);
        server.broadcastEvent("run", "onFinished", data);
    }

    @Override
    public void onReadyToExit() {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        server.broadcastEvent("run", "onReadyToExit", data);
    }
}
