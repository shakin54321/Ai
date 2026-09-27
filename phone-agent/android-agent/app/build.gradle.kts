plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.shakin.phoneagent"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.shakin.phoneagent"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
}
