package ru.varryal.launcher.bridge;

import com.google.gson.JsonObject;
import pro.gravit.launcher.core.backend.LauncherBackendAPI;

import java.util.Map;

/**
 * Bridges LauncherBackendAPI.DownloadCallback to WebSocket events on channel "download".
 * DownloadCallback is a class — we extend it.
 */
public class WsDownloadCallback extends LauncherBackendAPI.DownloadCallback {

    private final WsBridgeServer server;
    private final String readyProfileId;
    private final Map<String, Runnable> cancelRunnables;

    public WsDownloadCallback(WsBridgeServer server, String readyProfileId, Map<String, Runnable> cancelRunnables) {
        this.server = server;
        this.readyProfileId = readyProfileId;
        this.cancelRunnables = cancelRunnables;
    }

    @Override
    public void onStartPhase(LauncherBackendAPI.DownloadCallback.UpdatePhase phase) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        data.addProperty("phase", phase != null ? phase.name() : "");
        server.broadcastEvent("download", "onStartPhase", data);
    }

    @Override
    public void onStage(String stage) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        data.addProperty("stage", stage != null ? stage : "");
        server.broadcastEvent("download", "onStage", data);
    }

    @Override
    public void onTotalDownload(long bytes) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        data.addProperty("bytes", bytes);
        server.broadcastEvent("download", "onTotalDownload", data);
    }

    @Override
    public void onCurrentDownloaded(long bytes) {
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        data.addProperty("bytes", bytes);
        server.broadcastEvent("download", "onCurrentDownloaded", data);
    }

    @Override
    public void onCanCancel(Runnable cancel) {
        cancelRunnables.put(readyProfileId, cancel);
        JsonObject data = new JsonObject();
        data.addProperty("readyProfileId", readyProfileId);
        server.broadcastEvent("download", "onCanCancel", data);
    }
}
