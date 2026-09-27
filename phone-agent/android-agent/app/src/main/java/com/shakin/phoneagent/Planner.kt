package com.shakin.phoneagent

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Planner {
    const val MODEL = "openai/gpt-oss-120b"
    private const val BASE_URL = "https://api.groq.com/openai/v1"

    data class Action(val type: String, val arg: String = "", val ms: Long = 0L)

    data class Plan(
        val message: String,
        val actions: List<Action>,
        val risky: Boolean = false,
        val done: Boolean = false
    )

    fun testApiKey(apiKey: String): String {
        val key = apiKey.trim()
        if (key.isBlank()) return "API key is empty."

        val connection = (URL(BASE_URL + "/models").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Authorization", "Bearer " + key)
            setRequestProperty("Accept", "application/json")
        }

        return try {
            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()

            if (code in 200..299) "Connected to Groq."
            else extractGroqError(text, code)
        } catch (e: Exception) {
            "Connection failed: " + (e.message ?: "network error")
        } finally {
            connection.disconnect()
        }
    }

    fun next(command: String, ui: String, apps: String, apiKey: String): Plan {
        if (apiKey.isBlank()) return fallback(command)

        return try {
            val system = """
You are Shakin Agent, an Android phone-control planner.
Return ONLY valid JSON.
The host app can execute these actions:
open_app, tap_text, tap_description, tap_coordinates, type_text,
back, home, recents, swipe, scroll, open_url, wait.

Rules:
1. Use the current UI text and installed launcher-app labels as the source of truth.
2. For multi-step tasks return a SMALL batch that can work on the current screen.
3. After a screen change the host refreshes the UI and asks again.
4. Never invent visible text, app labels, coordinates, package names, or actions.
5. Set done=true only when the user's requested task is actually complete or no action is needed.
6. Set risky=true for sending/posting/calling/deleting/purchasing/payment/account or security changes.
7. Keep message under 120 characters.
""".trimIndent()

            val user = """
User command:
$command

Current visible UI:
${ui.ifBlank { "(none visible)" }}

Installed launcher apps:
${apps.ifBlank { "(unknown)" }}
""".trimIndent()

            val body = JSONObject()
                .put("model", MODEL)
                .put("temperature", 0.0)
                .put("max_completion_tokens", 900)
                .put("response_format", JSONObject().put("type", "json_object"))
                .put(
                    "messages",
                    JSONArray()
                        .put(JSONObject().put("role", "system").put("content", system))
                        .put(JSONObject().put("role", "user").put("content", user))
                )

            val response = postChat(body, apiKey)
            val content = response
                .getJSONArray("choices")
                .getJSONObject(0)
                .getJSONObject("message")
                .optString("content")
                .trim()

            if (content.isBlank()) {
                return Plan("Groq returned an empty response.", emptyList(), done = true)
            }

            parse(JSONObject(content))
        } catch (e: Exception) {
            Plan(
                message = "Groq error: " + (e.message ?: "request failed").take(160),
                actions = emptyList(),
                done = true
            )
        }
    }

    private fun postChat(body: JSONObject, apiKey: String): JSONObject {
        val connection = (URL(BASE_URL + "/chat/completions").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 45_000
            useCaches = false
            setRequestProperty("Authorization", "Bearer " + apiKey.trim())
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }

        return try {
            connection.outputStream.use {
                it.write(body.toString().toByteArray(Charsets.UTF_8))
            }

            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()
                ?.use { it.readText() }
                .orEmpty()

            if (code !in 200..299) {
                throw IllegalStateException(extractGroqError(text, code))
            }
            if (text.isBlank()) {
                throw IllegalStateException("Empty response from Groq.")
            }

            JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun extractGroqError(text: String, code: Int): String {
        return try {
            JSONObject(text)
                .optJSONObject("error")
                ?.optString("message")
                ?.trim()
                ?.takeIf { it.isNotBlank() }
                ?: "Groq request failed (HTTP " + code + ")."
        } catch (_: Exception) {
            "Groq request failed (HTTP " + code + ")."
        }
    }

    private fun parse(json: JSONObject): Plan {
        val actionsJson = json.optJSONArray("actions") ?: JSONArray()
        val actions = mutableListOf<Action>()

        for (i in 0 until actionsJson.length()) {
            val item = actionsJson.optJSONObject(i) ?: continue
            val type = item.optString("type").trim()
            if (type !in allowedTypes) continue

            val arg = when (type) {
                "tap_coordinates" -> {
                    val x = item.optInt("x", -1)
                    val y = item.optInt("y", -1)
                    if (x < 0 || y < 0) "" else x.toString() + "," + y.toString()
                }
                else -> item.optString("arg").trim()
            }

            actions += Action(
                type = type,
                arg = arg,
                ms = item.optLong("ms", 0L)
            )
        }

        return Plan(
            message = json.optString("message", "Working…").trim(),
            actions = actions,
            risky = json.optBoolean("risky", false),
            done = json.optBoolean("done", actions.isEmpty())
        )
    }

    private fun fallback(command: String): Plan {
        val raw = command.trim()
        val lower = raw.lowercase()

        return when {
            lower == "home" || lower == "go home" ->
                Plan("Going home.", listOf(Action("home")))
            lower == "back" || lower == "go back" ->
                Plan("Going back.", listOf(Action("back")))
            lower == "recents" || lower == "open recents" ->
                Plan("Opening Recents.", listOf(Action("recents")))
            lower.startsWith("open http://") || lower.startsWith("open https://") ->
                Plan("Opening the link.", listOf(Action("open_url", raw.substringAfter(' '))))
            lower.startsWith("open ") || lower.startsWith("launch ") ->
                Plan("Opening the app.", listOf(Action("open_app", raw.substringAfter(' '))))
            lower.startsWith("tap ") || lower.startsWith("press ") ->
                Plan("Tapping the control.", listOf(Action("tap_text", raw.substringAfter(' '))))
            lower.startsWith("type ") || lower.startsWith("write ") ->
                Plan("Typing the text.", listOf(Action("type_text", raw.substringAfter(' '))))
            lower.contains("scroll up") || lower.contains("swipe up") ->
                Plan("Scrolling up.", listOf(Action("swipe", "up")))
            lower.contains("scroll down") || lower.contains("swipe down") ->
                Plan("Scrolling down.", listOf(Action("swipe", "down")))
            else ->
                Plan("Add a Groq API key for natural-language control.", emptyList(), done = true)
        }
    }

    private val allowedTypes = setOf(
        "open_app", "tap_text", "tap_description", "tap_coordinates", "type_text",
        "back", "home", "recents", "swipe", "scroll", "open_url", "wait"
    )
}
