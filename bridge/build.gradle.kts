plugins {
    java
}

group = "ru.varryal.launcher"
version = "1.0.0"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    maven {
        name = "GravitLauncher"
        url = uri("https://maven.gravitlauncher.com")
    }
    mavenCentral()
    mavenLocal()
}

dependencies {
    // GravitLauncher 5.7.12 runtime (provides LauncherBackendAPI, RuntimeProvider, etc.)
    compileOnly("com.gravitlauncher.launcher:launcher-runtime:5.7.12")

    // Embedded WebSocket server
    implementation("org.java-websocket:Java-WebSocket:1.5.6")

    // JSON serialisation
    implementation("com.google.code.gson:gson:2.11.0")

    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.jar {
    // Include runtime deps (Java-WebSocket, Gson) in the fat jar
    from(configurations.runtimeClasspath.get().map { if (it.isDirectory) it else zipTree(it) })
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE

    manifest {
        attributes(
            "Module-Main-Class"   to "ru.varryal.launcher.bridge.BridgeRuntimeModule",
            "Module-Config-Class" to "ru.varryal.launcher.bridge.config.BridgeModuleConfig",
            "Module-Config-Name"  to "VarryalRuntime",
            // Standard jar metadata
            "Implementation-Title"   to "Varryal Bridge Runtime",
            "Implementation-Version" to project.version,
        )
    }
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

tasks.test {
    useJUnitPlatform()
}
