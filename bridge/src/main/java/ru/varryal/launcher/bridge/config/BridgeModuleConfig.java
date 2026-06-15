package ru.varryal.launcher.bridge.config;

/**
 * Module configuration for VarryalRuntime.
 * Fields annotated with @LauncherInject are populated by the LaunchServer
 * build pipeline when the module is bundled into the signed launcher jar.
 *
 * Jar manifest: Module-Config-Class = ru.varryal.launcher.bridge.config.BridgeModuleConfig
 *               Module-Config-Name  = VarryalRuntime
 */
public class BridgeModuleConfig {

    /**
     * IPC port override. If 0 (default), the bridge picks a random high port.
     * Can be injected by the build pipeline or passed via -Dvarryal.ipc.port=<N>.
     */
    public int ipcPort = 0;

    /**
     * Timeout in milliseconds the bridge waits for the Rust shell to connect
     * before logging a warning (but continuing to serve).
     */
    public int shellConnectTimeoutMs = 30000;

    /**
     * If true, the bridge logs all WS messages at DEBUG level (very verbose).
     */
    public boolean debugProtocol = false;

    /**
     * Version string injected by build pipeline for display purposes.
     */
    public String version = "1.0.0";
}
