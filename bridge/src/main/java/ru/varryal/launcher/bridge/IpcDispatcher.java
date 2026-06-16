package ru.varryal.launcher.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.java_websocket.WebSocket;
import pro.gravit.launcher.core.api.LauncherAPIHolder;
import pro.gravit.launcher.core.api.features.ProfileFeatureAPI;
import pro.gravit.launcher.core.api.method.AuthMethod;
import pro.gravit.launcher.core.api.method.AuthMethodPassword;
import pro.gravit.launcher.base.Launcher;
import pro.gravit.launcher.base.request.auth.password.AuthAESPassword;
import pro.gravit.launcher.base.request.auth.password.AuthPlainPassword;
import pro.gravit.utils.helper.SecurityHelper;
import pro.gravit.launcher.core.api.model.SelfUser;
import pro.gravit.launcher.core.backend.LauncherBackendAPI;
import pro.gravit.launcher.core.backend.LauncherBackendAPIHolder;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;

/**
 * Dispatches incoming IPC requests to LauncherBackendAPI and sends responses/events.
 * All API method signatures verified against launcher-core-5.7.10.jar via javap.
 */
public class IpcDispatcher {

    private final LauncherBackendAPI api;
    private final WsBridgeServer server;
    private final String sessionToken;
    private final CountDownLatch shutdownLatch;

    // Registry: readyProfileId -> ReadyProfile
    private final Map<String, LauncherBackendAPI.ReadyProfile> readyProfiles = new ConcurrentHashMap<>();
    // Registry: readyProfileId -> cancel Runnable (from DownloadCallback.onCanCancel)
    private final Map<String, Runnable> cancelRunnables = new ConcurrentHashMap<>();
    // Registry: readyProfileId -> terminate Runnable (from RunCallback.onCanTerminate)
    private final Map<String, Runnable> terminateRunnables = new ConcurrentHashMap<>();

    // Cache resolved profile list for UUID lookup
    private volatile List<ProfileFeatureAPI.ClientProfile> cachedProfiles;
    // Cache last known auth methods from init()
    private volatile List<AuthMethod> cachedAuthMethods;

    public IpcDispatcher(LauncherBackendAPI api, WsBridgeServer server,
                         String sessionToken, CountDownLatch shutdownLatch) {
        this.api = api;
        this.server = server;
        this.sessionToken = sessionToken;
        this.shutdownLatch = shutdownLatch;
        api.setCallback(new WsMainCallback(server));
    }

    public void onClientConnected(WebSocket conn) {}
    public void onClientDisconnected(WebSocket conn) {}

    public void handleMessage(WebSocket conn, String raw) {
        JsonObject msg;
        try {
            msg = JsonParser.parseString(raw).getAsJsonObject();
        } catch (Exception e) {
            sendError(conn, null, "PARSE_ERROR", "Invalid JSON");
            return;
        }
        String token = msg.has("token") ? msg.get("token").getAsString() : "";
        if (!sessionToken.equals(token)) {
            sendError(conn, msgId(msg), "AUTH_TOKEN", "bad token");
            return;
        }
        String type = msg.has("type") ? msg.get("type").getAsString() : "";
        if (!"request".equals(type)) return;

        String id = msgId(msg);
        String method = msg.has("method") ? msg.get("method").getAsString() : "";
        JsonObject params = msg.has("params") ? msg.getAsJsonObject("params") : new JsonObject();
        dispatch(conn, id, method, params);
    }

    private void dispatch(WebSocket conn, String id, String method, JsonObject params) {
        try {
            switch (method) {
                case "init"                       -> handleInit(conn, id);
                case "selectAuthMethod"           -> handleSelectAuthMethod(conn, id, params);
                case "tryAuthorize"               -> handleTryAuthorize(conn, id);
                case "authorize"                  -> handleAuthorize(conn, id, params);
                case "userExit"                   -> handleUserExit(conn, id);
                case "fetchProfiles"              -> handleFetchProfiles(conn, id);
                case "makeClientProfileSettings"  -> handleMakeClientProfileSettings(conn, id, params);
                case "saveClientProfileSettings"  -> handleSaveClientProfileSettings(conn, id, params);
                case "downloadProfile"            -> handleDownloadProfile(conn, id, params);
                case "runProfile"                 -> handleRunProfile(conn, id, params);
                case "cancelDownload"             -> handleCancelDownload(conn, id, params);
                case "terminateGame"              -> handleTerminateGame(conn, id, params);
                case "getAvailableJava"           -> handleGetAvailableJava(conn, id);
                case "pingServer"                 -> handlePingServer(conn, id, params);
                case "pingProfileServers"         -> handlePingProfileServers(conn, id, params);
                case "getUserSettings"            -> handleGetUserSettings(conn, id, params);
                case "getSelfUser"                -> handleGetSelfUser(conn, id);
                case "isTestMode"                 -> handleIsTestMode(conn, id);
                case "shutdown"                   -> handleShutdown(conn, id);
                default -> sendError(conn, id, "UNKNOWN_METHOD", "Unknown method: " + method);
            }
        } catch (Exception e) {
            System.err.println("[VarryalBridge] Error handling method=" + method + ": " + e);
            sendError(conn, id, "INTERNAL", e.getMessage());
        }
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    private void handleInit(WebSocket conn, String id) {
        // LauncherInitData is a record: methods() returns List<AuthMethod>
        api.init().whenComplete((data, err) -> {
            if (err != null) { sendError(conn, id, "INIT_FAILED", err.getMessage()); return; }
            JsonArray methods = new JsonArray();
            if (data != null && data.methods() != null) {
                cachedAuthMethods = data.methods();
                for (AuthMethod m : data.methods()) {
                    JsonObject mo = new JsonObject();
                    mo.addProperty("name", m.getName());
                    mo.addProperty("displayName", m.getDisplayName());
                    mo.addProperty("visible", m.isVisible());
                    methods.add(mo);
                }
            }
            JsonObject result = new JsonObject();
            result.add("authMethods", methods);
            result.addProperty("updateRequired", false); // LauncherInitData has no updateRequired field
            sendResult(conn, id, result);
        });
    }

    private void handleSelectAuthMethod(WebSocket conn, String id, JsonObject params) {
        String methodName = params.has("method") ? params.get("method").getAsString() : "";
        // Find the AuthMethod object from cached list
        AuthMethod found = null;
        if (cachedAuthMethods != null) {
            for (AuthMethod m : cachedAuthMethods) {
                if (m.getName().equals(methodName)) { found = m; break; }
            }
        }
        if (found == null) {
            // Fallback: try changeAuthId directly on the holder
            try {
                LauncherAPIHolder.changeAuthId(methodName);
                sendResult(conn, id, new JsonObject());
            } catch (Exception e) {
                sendError(conn, id, "SELECT_AUTH_FAILED", e.getMessage());
            }
            return;
        }
        try {
            api.selectAuthMethod(found);
            sendResult(conn, id, new JsonObject());
        } catch (Exception e) {
            sendError(conn, id, "SELECT_AUTH_FAILED", e.getMessage());
        }
    }

    private void handleTryAuthorize(WebSocket conn, String id) {
        api.tryAuthorize().whenComplete((user, err) -> {
            JsonObject result = new JsonObject();
            result.add("user", user != null ? serializeUserStatic(user) : com.google.gson.JsonNull.INSTANCE);
            sendResult(conn, id, result);
        });
    }

    private void handleAuthorize(WebSocket conn, String id, JsonObject params) {
        String login = params.has("login") ? params.get("login").getAsString() : "";
        String password = params.has("password") ? params.get("password").getAsString() : "";
        AuthMethodPassword authPassword = makePassword(password);
        api.authorize(login, authPassword).whenComplete((user, err) -> {
            if (err != null) { sendError(conn, id, "AUTH_FAILED", err.getMessage()); return; }
            JsonObject result = new JsonObject();
            result.add("user", serializeUserStatic(user));
            sendResult(conn, id, result);
        });
    }

    /**
     * Build the password object exactly like the reference JavaFX AuthService:
     * AES-encrypt with the injected passwordEncryptKey when present, else plain.
     * Crucially uses base.request.auth.password.* (the wire-protocol types the
     * LaunchServer expects), NOT core.api.method.password.* — the latter is not
     * recognised on the wire and yields a false "wrong password".
     */
    private AuthMethodPassword makePassword(String plainPassword) {
        String key = Launcher.getConfig().passwordEncryptKey;
        if (key != null) {
            try {
                return new AuthAESPassword(SecurityHelper.encrypt(key, plainPassword));
            } catch (Exception ignored) {
            }
        }
        return new AuthPlainPassword(plainPassword);
    }

    private void handleUserExit(WebSocket conn, String id) {
        api.userExit().whenComplete((v, err) -> {
            if (err != null) { sendError(conn, id, "EXIT_FAILED", err.getMessage()); return; }
            sendResult(conn, id, new JsonObject());
        });
    }

    private void handleFetchProfiles(WebSocket conn, String id) {
        api.fetchProfiles().whenComplete((profiles, err) -> {
            if (err != null) { sendError(conn, id, "PROFILES_FAILED", err.getMessage()); return; }
            cachedProfiles = profiles;
            JsonArray arr = new JsonArray();
            if (profiles != null) {
                for (var p : profiles) arr.add(serializeProfileStatic(p));
            }
            JsonObject result = new JsonObject();
            result.add("profiles", arr);
            sendResult(conn, id, result);
        });
    }

    private void handleMakeClientProfileSettings(WebSocket conn, String id, JsonObject params) {
        String uuid = params.has("profileUuid") ? params.get("profileUuid").getAsString() : "";
        var profile = findProfileByUuid(uuid);
        if (profile == null) { sendError(conn, id, "PROFILE_NOT_FOUND", uuid); return; }
        var settings = api.makeClientProfileSettings(profile);
        JsonObject result = new JsonObject();
        result.add("settings", serializeSettings(settings));
        sendResult(conn, id, result);
    }

    private void handleSaveClientProfileSettings(WebSocket conn, String id, JsonObject params) {
        JsonObject settingsJson = params.has("settings") ? params.getAsJsonObject("settings") : new JsonObject();
        String uuid = settingsJson.has("profileUuid") ? settingsJson.get("profileUuid").getAsString() : "";
        var profile = findProfileByUuid(uuid);
        if (profile == null) { sendError(conn, id, "PROFILE_NOT_FOUND", uuid); return; }
        var settings = api.makeClientProfileSettings(profile);
        applySettingsFromJson(settings, settingsJson);
        api.saveClientProfileSettings(settings);
        sendResult(conn, id, new JsonObject());
    }

    private void handleDownloadProfile(WebSocket conn, String id, JsonObject params) {
        String uuid = params.has("profileUuid") ? params.get("profileUuid").getAsString() : "";
        var profile = findProfileByUuid(uuid);
        if (profile == null) { sendError(conn, id, "PROFILE_NOT_FOUND", uuid); return; }

        JsonObject settingsJson = params.has("settings") ? params.getAsJsonObject("settings") : new JsonObject();
        var settings = api.makeClientProfileSettings(profile);
        applySettingsFromJson(settings, settingsJson);

        String readyProfileId = UUID.randomUUID().toString();
        var downloadCallback = new WsDownloadCallback(server, readyProfileId, cancelRunnables);

        // Respond immediately with the readyProfileId; progress comes via events
        JsonObject result = new JsonObject();
        result.addProperty("readyProfileId", readyProfileId);
        sendResult(conn, id, result);

        api.downloadProfile(profile, settings, downloadCallback).whenComplete((readyProfile, err) -> {
            if (err != null) {
                JsonObject data = new JsonObject();
                data.addProperty("readyProfileId", readyProfileId);
                data.addProperty("error", errorDetail(err));
                server.broadcastEvent("download", "onError", data);
                return;
            }
            readyProfiles.put(readyProfileId, readyProfile);
            JsonObject data = new JsonObject();
            data.addProperty("readyProfileId", readyProfileId);
            server.broadcastEvent("download", "onComplete", data);
        });
    }

    private void handleRunProfile(WebSocket conn, String id, JsonObject params) {
        String readyProfileId = params.has("readyProfileId") ? params.get("readyProfileId").getAsString() : "";
        var readyProfile = readyProfiles.get(readyProfileId);
        if (readyProfile == null) { sendError(conn, id, "READY_PROFILE_NOT_FOUND", readyProfileId); return; }
        sendResult(conn, id, new JsonObject());
        var runCallback = new WsRunCallback(server, readyProfileId, terminateRunnables);
        try {
            readyProfile.run(runCallback);
        } catch (Exception e) {
            JsonObject data = new JsonObject();
            data.addProperty("readyProfileId", readyProfileId);
            data.addProperty("error", errorDetail(e));
            server.broadcastEvent("run", "onError", data);
        }
    }

    private void handleCancelDownload(WebSocket conn, String id, JsonObject params) {
        String readyProfileId = params.has("readyProfileId") ? params.get("readyProfileId").getAsString() : "";
        Runnable cancel = cancelRunnables.remove(readyProfileId);
        if (cancel != null) cancel.run();
        sendResult(conn, id, new JsonObject());
    }

    private void handleTerminateGame(WebSocket conn, String id, JsonObject params) {
        String readyProfileId = params.has("readyProfileId") ? params.get("readyProfileId").getAsString() : "";
        Runnable terminate = terminateRunnables.remove(readyProfileId);
        if (terminate != null) terminate.run();
        sendResult(conn, id, new JsonObject());
    }

    private void handleGetAvailableJava(WebSocket conn, String id) {
        // LauncherBackendAPI.Java: getMajorVersion(), getPath()
        api.getAvailableJava().whenComplete((javas, err) -> {
            if (err != null) { sendError(conn, id, "JAVA_FAILED", err.getMessage()); return; }
            JsonArray arr = new JsonArray();
            if (javas != null) {
                int idx = 0;
                for (LauncherBackendAPI.Java j : javas) {
                    JsonObject jo = new JsonObject();
                    jo.addProperty("index", idx++);
                    jo.addProperty("version", j.getMajorVersion());
                    jo.addProperty("path", j.getPath() != null ? j.getPath().toString() : "");
                    arr.add(jo);
                }
            }
            JsonObject result = new JsonObject();
            result.add("java", arr);
            sendResult(conn, id, result);
        });
    }

    private void handlePingServer(WebSocket conn, String id, JsonObject params) {
        String uuid = params.has("profileUuid") ? params.get("profileUuid").getAsString() : "";
        var profile = findProfileByUuid(uuid);
        if (profile == null) { sendError(conn, id, "PROFILE_NOT_FOUND", uuid); return; }
        api.pingServer(profile).whenComplete((ping, err) -> {
            if (err != null) { sendError(conn, id, "PING_FAILED", err.getMessage()); return; }
            JsonObject result = new JsonObject();
            result.add("ping", serializePing(ping));
            sendResult(conn, id, result);
        });
    }

    private void handlePingProfileServers(WebSocket conn, String id, JsonObject params) {
        // pingProfileServers not present in 5.7.10 API — fall back to pingServer
        handlePingServer(conn, id, params);
    }

    private void handleGetUserSettings(WebSocket conn, String id, JsonObject params) {
        String name = params.has("name") ? params.get("name").getAsString() : "";
        // Real signature: getUserSettings(String name, Function<String, UserSettings> factory)
        // We pass a factory that returns null so no new object is created if no settings exist.
        Object rawSettings;
        try {
            rawSettings = api.getUserSettings(name, k -> null);
        } catch (Exception e) {
            sendError(conn, id, "SETTINGS_FAILED", e.getMessage());
            return;
        }
        JsonObject result = new JsonObject();
        result.add("settings", rawSettings != null ? WsBridgeServer.GSON.toJsonTree(rawSettings) : new JsonObject());
        sendResult(conn, id, result);
    }

    private void handleGetSelfUser(WebSocket conn, String id) {
        SelfUser user = api.getSelfUser();
        JsonObject result = new JsonObject();
        result.add("user", user != null ? serializeUserStatic(user) : com.google.gson.JsonNull.INSTANCE);
        result.addProperty("username", api.getUsername() != null ? api.getUsername() : "");
        sendResult(conn, id, result);
    }

    private void handleIsTestMode(WebSocket conn, String id) {
        JsonObject result = new JsonObject();
        result.addProperty("testMode", api.isTestMode());
        sendResult(conn, id, result);
    }

    private void handleShutdown(WebSocket conn, String id) {
        sendResult(conn, id, new JsonObject());
        api.shutdown();
        shutdownLatch.countDown();
    }

    // ── Static serializers (used also by WsMainCallback) ──────────────────────

    /**
     * SelfUser interface: getUsername(), getUUID(), getAccessToken() (from User + SelfUser).
     */
    public static JsonObject serializeUserStatic(SelfUser user) {
        JsonObject o = new JsonObject();
        if (user == null) return o;
        o.addProperty("username", user.getUsername() != null ? user.getUsername() : "");
        o.addProperty("uuid", user.getUUID() != null ? user.getUUID().toString() : "");
        o.addProperty("accessToken", user.getAccessToken() != null ? user.getAccessToken() : "");
        return o;
    }

    /**
     * ProfileFeatureAPI.ClientProfile: getName(), getUUID(), getMinecraftVersion(), getServer().
     */
    public static JsonObject serializeProfileStatic(ProfileFeatureAPI.ClientProfile p) {
        JsonObject o = new JsonObject();
        if (p == null) return o;
        o.addProperty("uuid", p.getUUID() != null ? p.getUUID().toString() : "");
        o.addProperty("title", p.getName() != null ? p.getName() : "");
        o.addProperty("version", p.getMinecraftVersion() != null ? p.getMinecraftVersion() : "");
        o.addProperty("description", p.getDescription() != null ? p.getDescription() : "");
        var server = p.getServer();
        if (server != null) {
            o.addProperty("serverAddress", server.getAddress() != null ? server.getAddress() : "");
            o.addProperty("serverPort", server.getPort());
        } else {
            o.addProperty("serverAddress", "");
            o.addProperty("serverPort", 25565);
        }
        // Optional mods list
        JsonArray optionals = new JsonArray();
        if (p.getOptionalMods() != null) {
            for (var mod : p.getOptionalMods()) {
                JsonObject mo = new JsonObject();
                mo.addProperty("name", mod.getName() != null ? mod.getName() : "");
                mo.addProperty("description", mod.getDescription() != null ? mod.getDescription() : "");
                mo.addProperty("category", mod.getCategory() != null ? mod.getCategory() : "");
                mo.addProperty("visible", mod.isVisible());
                optionals.add(mo);
            }
        }
        o.add("optionalMods", optionals);
        return o;
    }

    private JsonObject serializeSettings(LauncherBackendAPI.ClientProfileSettings s) {
        JsonObject o = new JsonObject();
        if (s == null) return o;
        // getReservedMemoryBytes requires MemoryClass enum parameter
        o.addProperty("reservedMemoryMb",
                s.getReservedMemoryBytes(LauncherBackendAPI.ClientProfileSettings.MemoryClass.TOTAL) / (1024L * 1024L));
        // Flags
        JsonObject flags = new JsonObject();
        for (LauncherBackendAPI.ClientProfileSettings.Flag f : LauncherBackendAPI.ClientProfileSettings.Flag.values()) {
            flags.addProperty(f.name(), s.hasFlag(f));
        }
        o.add("flags", flags);
        // Selected java
        var java = s.getSelectedJava();
        if (java != null) {
            o.addProperty("selectedJavaMajor", java.getMajorVersion());
            o.addProperty("selectedJavaPath", java.getPath() != null ? java.getPath().toString() : "");
        }
        return o;
    }

    private JsonObject serializePing(LauncherBackendAPI.ServerPingInfo ping) {
        JsonObject o = new JsonObject();
        if (ping == null) return o;
        // ServerPingInfo: getMaxOnline(), getOnline(), getPlayerNames()
        o.addProperty("maxOnline", ping.getMaxOnline());
        o.addProperty("online", ping.getOnline());
        JsonArray names = new JsonArray();
        if (ping.getPlayerNames() != null) {
            for (String name : ping.getPlayerNames()) names.add(name);
        }
        o.add("playerNames", names);
        return o;
    }

    // ── Settings JSON apply ───────────────────────────────────────────────────

    private void applySettingsFromJson(LauncherBackendAPI.ClientProfileSettings settings, JsonObject json) {
        if (json.has("reservedMemoryMb")) {
            long mb = json.get("reservedMemoryMb").getAsLong();
            settings.setReservedMemoryBytes(LauncherBackendAPI.ClientProfileSettings.MemoryClass.TOTAL, mb * 1024L * 1024L);
        }
        if (json.has("flags")) {
            var flags = json.getAsJsonObject("flags");
            for (LauncherBackendAPI.ClientProfileSettings.Flag f : LauncherBackendAPI.ClientProfileSettings.Flag.values()) {
                if (flags.has(f.name())) {
                    if (flags.get(f.name()).getAsBoolean()) settings.addFlag(f);
                    else settings.removeFlag(f);
                }
            }
        }
    }

    // ── Profile lookup ────────────────────────────────────────────────────────

    private ProfileFeatureAPI.ClientProfile findProfileByUuid(String uuid) {
        if (cachedProfiles == null || uuid == null || uuid.isEmpty()) return null;
        for (var p : cachedProfiles) {
            if (p.getUUID() != null && p.getUUID().toString().equals(uuid)) return p;
        }
        return null;
    }

    // ── Response helpers ──────────────────────────────────────────────────────

    private void sendResult(WebSocket conn, String id, JsonObject result) {
        JsonObject msg = new JsonObject();
        if (id != null) msg.addProperty("id", id);
        msg.addProperty("type", "response");
        msg.addProperty("ok", true);
        msg.add("result", result);
        conn.send(WsBridgeServer.GSON.toJson(msg));
    }

    private void sendError(WebSocket conn, String id, String code, String message) {
        JsonObject err = new JsonObject();
        err.addProperty("code", code);
        err.addProperty("message", message != null ? message : "");
        JsonObject msg = new JsonObject();
        if (id != null) msg.addProperty("id", id);
        msg.addProperty("type", "response");
        msg.addProperty("ok", false);
        msg.add("error", err);
        try { conn.send(WsBridgeServer.GSON.toJson(msg)); } catch (Exception ignored) {}
    }

    private static String msgId(JsonObject msg) {
        return msg.has("id") ? msg.get("id").getAsString() : null;
    }

    /**
     * Produce a full diagnostic string (root-cause type, message and stack trace)
     * for an exception surfaced to the frontend. CompletableFuture wraps failures in
     * CompletionException/ExecutionException, so unwrap to the real cause first —
     * otherwise the UI only ever sees a bare "java.lang.NullPointerException".
     */
    private static String errorDetail(Throwable t) {
        if (t == null) return "unknown error";
        Throwable root = t;
        while ((root instanceof java.util.concurrent.CompletionException
                || root instanceof java.util.concurrent.ExecutionException)
                && root.getCause() != null && root.getCause() != root) {
            root = root.getCause();
        }
        java.io.StringWriter sw = new java.io.StringWriter();
        root.printStackTrace(new java.io.PrintWriter(sw));
        return sw.toString();
    }
}
