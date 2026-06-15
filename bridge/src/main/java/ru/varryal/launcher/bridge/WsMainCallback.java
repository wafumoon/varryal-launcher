package ru.varryal.launcher.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import pro.gravit.launcher.core.api.features.ProfileFeatureAPI;
import pro.gravit.launcher.core.api.model.SelfUser;
import pro.gravit.launcher.core.backend.LauncherBackendAPI;

import java.util.List;

/**
 * Bridges LauncherBackendAPI.MainCallback to WebSocket events on channel "main".
 * MainCallback is a class (not interface) — we extend it.
 */
public class WsMainCallback extends LauncherBackendAPI.MainCallback {

    private final WsBridgeServer server;

    public WsMainCallback(WsBridgeServer server) {
        this.server = server;
    }

    @Override
    public void onChangeStatus(String status) {
        JsonObject data = new JsonObject();
        data.addProperty("status", status != null ? status : "");
        server.broadcastEvent("main", "onChangeStatus", data);
    }

    @Override
    public void onProfiles(List<ProfileFeatureAPI.ClientProfile> profiles) {
        JsonArray arr = new JsonArray();
        if (profiles != null) {
            for (var p : profiles) arr.add(IpcDispatcher.serializeProfileStatic(p));
        }
        JsonObject data = new JsonObject();
        data.add("profiles", arr);
        server.broadcastEvent("main", "onProfiles", data);
    }

    @Override
    public void onAuthorize(SelfUser user) {
        JsonObject data = new JsonObject();
        data.add("user", IpcDispatcher.serializeUserStatic(user));
        server.broadcastEvent("main", "onAuthorize", data);
    }

    @Override
    public void onNotify(String header, String description) {
        JsonObject data = new JsonObject();
        data.addProperty("header", header != null ? header : "");
        data.addProperty("description", description != null ? description : "");
        server.broadcastEvent("main", "onNotify", data);
    }

    @Override
    public void onExit() {
        server.broadcastEvent("main", "onExit", new JsonObject());
    }

    @Override
    public void onShutdown() {
        server.broadcastEvent("main", "onShutdown", new JsonObject());
    }
}
