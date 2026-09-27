package com.shakin.phoneagent

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Planner {
    const val MODEL = "openai/gpt-oss-120b"

    data class Action(val type: String, val arg: String = "", val ms: Long = 0)
    data class Plan(
        val message: String,
        val actions: List<Action>,
        val risky: Boolean = false,
        val done: Boolean = false
    )

    fun next(command: String, ui: String, apps: String, apiKey: String): Plan {
        if (apiKey.isBlank()) return fallback(command)

        return try {
            val system = """
You are Shakin Agent, an Android phone-control planner.
Return only valid JSON.
Use the current visible UI text and installed app labels.
For multi-step work, return the smallest batch that should work now. The host app will execute it, refresh the UI, and ask again.
Allowed actions: open_app, tap_text, tap_description, tap_coordinates, type_text,
back, home, recents, swipe, open_url, wait, scroll.
Set done=true when the task is already complete.
Set risky=true for sending/posting/calling/deleting/purchasing or account/security changes.
Never invent app labels or UI text.
Keep message under 120 characters.
""".trimIndent()

            val user = buildString {
                append("User command:\n")
                append(command)
                append("\n\nCurrent visible UI:\n")
                append(ui.ifBlank { "(none visible)" })
                append("\n\nInstalled app labels:\n")
                append(apps.ifBlank { "(unknown)" })
            }

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

            val response = post(body, apiKey)
            val content = response
                .getJSONArray("choices")
                .getJSONObject(0)
                .getJSONObject("message")
                .optString("content")
                .trim()

            if (content.isBlank()) return fallback(command)
            parse(JSONObject(content))
        } catch (_: Exception) {
            fallback(command)
        }
    }

    private fun post(body: JSONObject, apiKey: String): JSONObject {
        val connection = (URL("https://api.groq.com/openai/v1/chat/completions")
            .openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 15_000
            readTimeout = 45_000
            setRequestProperty("Authorization", "Bearer " + apiKey)
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }

        return try {
            connection.outputStream.use {
                it.write(body.toString().toByteArray(Charsets.UTF_8))
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299 || text.isBlank()) {
                throw IllegalStateException("Groq request failed.")
            }
            JSONObject(text)
        } finally {
            connection.disconnect()
        }
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
                arg = item.optString("arg"),
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
                Plan("Scrolling up.", listOf(Action("swipe_up")))
            lower.contains("scroll down") || lower.contains("swipe down") ->
                Plan("Scrolling down.", listOf(Action("swipe_down")))
            else ->
                Plan(
                    "Add your Groq API key in Settings for natural-language phone control.",
                    emptyList(),
                    done = true
                )
        }
    }

    private val allowedTypes = setOf(
        "open_app",
        "tap_text",
        "tap_description",
        "tap_coordinates",
        "type_text",
        "back",
        "home",
        "recents",
        "swipe_up",
        "swipe_down",
        "swipe",
        "open_url",
        "wait",
        "scroll"
    )
}
