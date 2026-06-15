package ru.varryal.launcher.bridge;

import pro.gravit.launcher.base.modules.LauncherInitContext;
import pro.gravit.launcher.base.modules.LauncherModule;
import pro.gravit.launcher.base.modules.LauncherModuleInfo;
import pro.gravit.launcher.runtime.client.events.ClientPreGuiPhase;
import pro.gravit.utils.Version;

/**
 * Entry module for the Varryal Bridge Runtime.
 * Replaces the JavaFX LauncherRuntime module with a WebSocket-based bridge
 * that exposes LauncherBackendAPI to the Tauri shell and React UI.
 *
 * Jar manifest:
 *   Module-Main-Class   = ru.varryal.launcher.bridge.BridgeRuntimeModule
 *   Module-Config-Class = ru.varryal.launcher.bridge.config.BridgeModuleConfig
 *   Module-Config-Name  = VarryalRuntime
 */
public class BridgeRuntimeModule extends LauncherModule {

    public static final String MODULE_NAME = "VarryalRuntime";
    public static final Version MODULE_VERSION = new Version(1, 0, 0);

    public BridgeRuntimeModule() {
        super(new LauncherModuleInfo(MODULE_NAME, MODULE_VERSION, new String[0]));
    }

    @Override
    public void init(LauncherInitContext initContext) {
        // Subscribe to ClientPreGuiPhase — this is the correct hook where
        // the JavaFX runtime (StdJavaRuntimeProvider) also installs itself.
        // Setting phase.runtimeProvider replaces whatever default was queued.
        registerEvent(this::onPreGui, ClientPreGuiPhase.class);
        System.out.println("[VarryalBridge] BridgeRuntimeModule initialised.");
    }

    private void onPreGui(ClientPreGuiPhase phase) {
        phase.runtimeProvider = new BridgeRuntimeProvider();
        System.out.println("[VarryalBridge] BridgeRuntimeProvider installed via ClientPreGuiPhase.");
    }
}
