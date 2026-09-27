package com.shakin.phoneagent

import android.content.Context
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import java.security.KeyStore

class SecureStore(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("secure_agent", Context.MODE_PRIVATE)
    private val alias = "ShakinAgentGroqKey"
    private val valueKey = "value"

    private fun key(): javax.crypto.SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = ks.getKey(alias, null) as? javax.crypto.SecretKey
        if (existing != null) return existing

        val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
        generator.init(
            android.security.keystore.KeyGenParameterSpec.Builder(
                alias,
                android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or
                    android.security.keystore.KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        )
        return generator.generateKey()
    }

    private fun deleteKey() {
        try {
            KeyStore.getInstance("AndroidKeyStore").apply {
                load(null)
                if (containsAlias(alias)) deleteEntry(alias)
            }
        } catch (_: Exception) {
        }
    }

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP)
    }

    private fun decrypt(packedText: String): String {
        val packed = Base64.decode(packedText, Base64.NO_WRAP)
        if (packed.size < 13) throw IllegalStateException("Stored key data is invalid.")
        val iv = packed.copyOfRange(0, 12)
        val encrypted = packed.copyOfRange(12, packed.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
        return String(cipher.doFinal(encrypted), Charsets.UTF_8)
    }

    fun put(value: String): Boolean {
        val trimmed = value.trim()

        if (trimmed.isBlank()) {
            return prefs.edit().remove(valueKey).commit()
        }

        return try {
            val encoded = encrypt(trimmed)
            val saved = prefs.edit().putString(valueKey, encoded).commit()
            saved && get() == trimmed
        } catch (_: Exception) {
            deleteKey()
            try {
                val encoded = encrypt(trimmed)
                val saved = prefs.edit().putString(valueKey, encoded).commit()
                saved && get() == trimmed
            } catch (_: Exception) {
                false
            }
        }
    }

    fun get(): String {
        val raw = prefs.getString(valueKey, null) ?: return ""
        if (raw.isBlank()) return ""

        return try {
            decrypt(raw)
        } catch (_: Exception) {
            ""
        }
    }
}
