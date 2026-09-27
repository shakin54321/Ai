package com.shakin.phoneagent

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Planner {

    const val MODEL = "openai/gpt-oss-120b"
    private const val BASE_URL = "https://api.groq.com/openai/v1"

    data class Action(
        val type: String,
        val arg: String = "",
        val ms: Long = 0L,
        val x: Int = 0,
        val y: Int = 0,
        val background: Boolean = false
    )

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
                ?.bufferedReader()?.use { it.readText() }.orEmpty()

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

        val system = """
You are Shakin Agent, an Android phone-control agent and friendly chat assistant.
Return ONLY valid JSON matching the supplied schema.

The host can execute:
open_app, open_app_background, tap_text, tap_description, tap_coordinates,
long_press_text, type_text, clear_text, back, home, recents,
notifications, quick_settings, power_dialog, lock_screen,
swipe, scroll, open_url, open_settings, wait, volume_up, volume_down, mute.

Core rules:
1. For a normal conversation/question, use no actions and put the natural answer in message.
2. For a phone task, use the smallest useful sequence of actions for the CURRENT screen.
3. After actions that change screens, the host will refresh the UI and call you again.
4. Use only visible UI text, visible content descriptions, and launcher app labels from the context.
5. Never invent a package name, hidden button, selector, or unsupported action.
6. Prefer tap_text or tap_description before coordinates. Use coordinates only when needed.
7. For typing, only use type_text when a text field is visibly focused or after an action that clearly focuses one.
8. For long multi-step tasks, do a small batch, then let the host re-plan.
9. Set done=true only when the request is complete or genuinely needs no action.
10. Use risky=true for sending/posting/calling/deleting/purchasing/payment/account/security changes.
11. For "in background" wording, set background=true on app-opening actions, but do not pretend the OS can hide arbitrary UI automation.
12. Keep message short and user-friendly, describing the current step.

Current screen and installed apps are supplied below.
""".trimIndent()

        val user = "User command:\n" + command +
            "\n\nCurrent visible UI:\n" + (ui.ifBlank { "(none visible)" }) +
            "\n\nInstalled launcher apps:\n" + (apps.ifBlank { "(unknown)" })

        val body = baseBody(system, user)
            .put("response_format", responseSchema())

        return try {
            parse(JSONObject(extractContent(postChat(body, apiKey))))
        } catch (first: Exception) {
            try {
                val retry = baseBody(
                    system + "\nReturn a compact JSON object. Do not spend the entire completion on reasoning.",
                    user
                )
                    .put("max_completion_tokens", 3200)
                    .put("response_format", responseSchema())

                parse(JSONObject(extractContent(postChat(retry, apiKey))))
            } catch (second: Exception) {
                Plan(
                    message = "Groq error: " + (second.message ?: first.message ?: "request failed").take(180),
                    actions = emptyList(),
                    done = true
                )
            }
        }
    }

    private fun baseBody(system: String, user: String): JSONObject =
        JSONObject()
            .put("model", MODEL)
            .put("temperature", 0.0)
            .put("reasoning_effort", "low")
            .put("max_completion_tokens", 1800)
            .put(
                "messages",
                JSONArray()
                    .put(JSONObject().put("role", "system").put("content", system))
                    .put(JSONObject().put("role", "user").put("content", user))
            )

    private fun responseSchema(): JSONObject =
        JSONObject()
            .put("type", "json_schema")
            .put(
                "json_schema",
                JSONObject()
                    .put("name", "phone_agent_plan")
                    .put("strict", true)
                    .put(
                        "schema",
                        JSONObject()
                            .put("type", "object")
                            .put(
                                "properties",
                                JSONObject()
                                    .put("message", JSONObject().put("type", "string"))
                                    .put("done", JSONObject().put("type", "boolean"))
                                    .put("risky", JSONObject().put("type", "boolean"))
                                    .put("actions", actionArraySchema())
                            )
                            .put(
                                "required",
                                JSONArray()
                                    .put("message")
                                    .put("done")
                                    .put("risky")
                                    .put("actions")
                            )
                            .put("additionalProperties", false)
                    )
            )

    private fun actionArraySchema(): JSONObject =
        JSONObject()
            .put("type", "array")
            .put(
                "items",
                JSONObject()
                    .put("type", "object")
                    .put(
                        "properties",
                        JSONObject()
                            .put(
                                "type",
                                JSONObject()
                                    .put("type", "string")
                                    .put("enum", JSONArray(allowedTypes.toList()))
                            )
                            .put("arg", JSONObject().put("type", "string"))
                            .put("ms", JSONObject().put("type", "integer"))
                            .put("x", JSONObject().put("type", "integer"))
                            .put("y", JSONObject().put("type", "integer"))
                            .put("background", JSONObject().put("type", "boolean"))
                    )
                    .put(
                        "required",
                        JSONArray()
                            .put("type")
                            .put("arg")
                            .put("ms")
                            .put("x")
                            .put("y")
                            .put("background")
                    )
                    .put("additionalProperties", false)
            )

    private fun extractContent(response: JSONObject): String {
        val content = response
            .optJSONArray("choices")
            ?.optJSONObject(0)
            ?.optJSONObject("message")
            ?.optString("content")
            ?.trim()
            .orEmpty()

        if (content.isBlank()) {
            throw IllegalStateException("Groq returned no message content.")
        }
        return content
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
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }

            val code = connection.responseCode
            val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (code !in 200..299) {
                throw IllegalStateException(extractGroqError(text, code))
            }
            if (text.isBlank()) throw IllegalStateException("Empty response from Groq.")
            JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun extractGroqError(text: String, code: Int): String =
        try {
            JSONObject(text)
                .optJSONObject("error")
                ?.optString("message")
                ?.trim()
                ?.takeIf { it.isNotBlank() }
                ?: "Groq request failed (HTTP " + code + ")."
        } catch (_: Exception) {
            "Groq request failed (HTTP " + code + ")."
        }

    private fun parse(json: JSONObject): Plan {
        val actionsJson = json.optJSONArray("actions") ?: JSONArray()
        val actions = mutableListOf<Action>()

        for (i in 0 until actionsJson.length()) {
            val item = actionsJson.optJSONObject(i) ?: continue
            val type = item.optString("type").trim()
            if (type !in allowedTypes) continue

            actions += Action(
                type = type,
                arg = item.optString("arg").trim(),
                ms = item.optLong("ms", 0L),
                x = item.optInt("x", 0),
                y = item.optInt("y", 0),
                background = item.optBoolean("background", false)
            )
        }

        val message = json.optString("message", "Working…").trim()
        val done = json.optBoolean("done", actions.isEmpty())

        return Plan(
            message = message,
            actions = actions,
            risky = json.optBoolean("risky", false),
            done = done
        )
    }

    private fun fallback(command: String): Plan {
        val raw = command.trim()
        val lower = raw.lowercase()

        val chat = when {
            lower in setOf("hi", "hello", "hey", "yo", "hiya", "হাই", "হ্যালো") ->
                "Hi! I'm ready. Tell me what you want me to do on your phone."
            lower.contains("how are you") || lower.contains("কেমন আছ") ->
                "I'm ready and working. Give me a phone task or ask me anything."
            lower.contains("what can you do") || lower.contains("কি করতে পার") ->
                "I can control visible phone UI, open apps, tap, type, scroll, navigate, and handle multi-step tasks."
            lower in setOf("thanks", "thank you", "ধন্যবাদ") ->
                "You're welcome."
            else -> null
        }
        if (chat != null) return Plan(chat, emptyList(), done = true)

        return when {
            lower == "home" || lower == "go home" ->
                Plan("Going home.", listOf(Action("home")))

            lower == "back" || lower == "go back" ->
                Plan("Going back.", listOf(Action("back")))

            lower == "recents" || lower == "open recents" ->
                Plan("Opening Recents.", listOf(Action("recents")))

            lower == "notifications" || lower == "open notifications" ->
                Plan("Opening notifications.", listOf(Action("notifications")))

            lower == "quick settings" || lower == "open quick settings" ->
                Plan("Opening quick settings.", listOf(Action("quick_settings")))

            lower.startsWith("open http://") || lower.startsWith("open https://") ->
                Plan("Opening the link.", listOf(Action("open_url", raw.substringAfter(' '))))

            lower.startsWith("open ") || lower.startsWith("launch ") ->
                Plan("Opening " + raw.substringAfter(' ') + ".", listOf(Action("open_app", raw.substringAfter(' '))))

            lower.startsWith("tap ") || lower.startsWith("press ") ->
                Plan("Tapping " + raw.substringAfter(' ') + ".", listOf(Action("tap_text", raw.substringAfter(' '))))

            lower.startsWith("type ") || lower.startsWith("write ") ->
                Plan("Typing the text.", listOf(Action("type_text", raw.substringAfter(' '))))

            lower == "scroll up" || lower == "swipe up" ->
                Plan("Scrolling up.", listOf(Action("swipe", "up")))

            lower == "scroll down" || lower == "swipe down" ->
                Plan("Scrolling down.", listOf(Action("swipe", "down")))

            else ->
                Plan("I can answer that through Groq, but a Groq API key is required.", emptyList(), done = true)
        }
    }

    private val allowedTypes = listOf(
        "open_app", "open_app_background", "tap_text", "tap_description",
        "tap_coordinates", "long_press_text", "type_text", "clear_text",
        "back", "home", "recents", "notifications", "quick_settings",
        "power_dialog", "lock_screen", "swipe", "scroll", "open_url",
        "open_settings", "wait", "volume_up", "volume_down", "mute"
    )
}
