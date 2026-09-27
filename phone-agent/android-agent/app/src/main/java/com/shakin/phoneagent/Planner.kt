package com.shakin.phoneagent

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Planner {
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
            val prompt = """
You control an Android phone through AccessibilityService.
The user gave this command:
\$command

Current visible UI text:
\${ui.ifBlank { "(no visible UI text)" }}

Installed app labels:
\${apps.ifBlank { "(unknown)" }}

Return ONLY valid JSON. No markdown.
Schema:
{
  "message": "short user-facing status",
  "done": false,
  "risky": false,
  "actions": [
    {"type":"open_app","arg":"YouTube"},
    {"type":"tap_text","arg":"Search"},
    {"type":"type_text","arg":"hello"},
    {"type":"back"},
    {"type":"home"},
    {"type":"swipe_up"},
    {"type":"swipe_down"},
    {"type":"open_url","arg":"https://example.com"},
    {"type":"wait","ms":500}
  ]
}

Rules:
- Choose only actions that can be performed from the current UI.
- Prefer visible text/content descriptions from the current UI.
- For multi-step work, return the smallest safe batch that should work NOW; the app will re-check the UI afterward.
- Set done=true when the task is already complete or no action is needed.
- Set risky=true for sending messages, calls, deleting/removing data, payments/purchases/transfers, password/security changes, uninstall/reset/shutdown, or other irreversible actions.
- Never invent package names.
- Keep message under 120 characters.
""".trimIndent()

            val body = JSONObject()
                .put("model", "openai/gpt-oss-20b")
                .put("temperature", 0.0)
                .put("max_completion_tokens", 700)
                .put("response_format", JSONObject().put("type", "json_object"))
                .put("messages", JSONArray()
                    .put(JSONObject()
                        .put("role", "system")
                        .put("content", "You are a precise Android UI action planner. Output JSON only."))
                    .put(JSONObject().put("role", "user").put("content", prompt)))

            val c = (URL("https://api.groq.com/openai/v1/chat/completions").openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 12000
                readTimeout = 25000
                setRequestProperty("Authorization", "Bearer \$apiKey")
                setRequestProperty("Content-Type", "application/json")
            }

            val responseText = try {
                c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
                stream?.bufferedReader()?.readText().orEmpty()
            } finally {
                c.disconnect()
            }

            if (responseText.isBlank()) return fallback(command)

            val root = JSONObject(responseText)
            val content = root.getJSONArray("choices")
                .getJSONObject(0)
                .getJSONObject("message")
                .optString("content")

            parse(JSONObject(content.trim()))
        } catch (_: Exception) {
            fallback(command)
        }
    }

    private fun parse(json: JSONObject): Plan {
        val actionsJson = json.optJSONArray("actions") ?: JSONArray()
        val actions = mutableListOf<Action>()
        for (i in 0 until actionsJson.length()) {
            val a = actionsJson.optJSONObject(i) ?: continue
            val type = a.optString("type").trim()
            if (type !in allowedTypes) continue
            actions += Action(type = type, arg = a.optString("arg"), ms = a.optLong("ms", 0L))
        }
        return Plan(
            message = json.optString("message", "Working…"),
            actions = actions,
            risky = json.optBoolean("risky", false),
            done = json.optBoolean("done", actions.isEmpty())
        )
    }

    private fun fallback(command: String): Plan {
        val c = command.trim()
        val l = c.lowercase()
        return when {
            l == "home" || l == "go home" || l == "open home" ->
                Plan("Going home.", listOf(Action("home")))
            l == "back" || l == "go back" ->
                Plan("Going back.", listOf(Action("back")))
            l.startsWith("open http://") || l.startsWith("open https://") ->
                Plan("Opening the link.", listOf(Action("open_url", c.substringAfter(' '))))
            l.startsWith("open ") || l.startsWith("launch ") ->
                Plan("Opening \${c.substringAfter(' ')}.", listOf(Action("open_app", c.substringAfter(' '))))
            l.startsWith("type ") || l.startsWith("write ") ->
                Plan("Typing the text.", listOf(Action("type_text", c.substringAfter(' '))))
            l.startsWith("tap ") || l.startsWith("press ") ->
                Plan("Tapping \${c.substringAfter(' ')}.", listOf(Action("tap_text", c.substringAfter(' '))))
            l.contains("scroll up") ->
                Plan("Scrolling up.", listOf(Action("swipe_up")))
            l.contains("scroll down") ->
                Plan("Scrolling down.", listOf(Action("swipe_down")))
            else ->
                Plan("Add your Groq API key in Settings for natural-language phone control.", emptyList(), done = true)
        }
    }

    private val allowedTypes = setOf(
        "open_app", "tap_text", "type_text", "back", "home",
        "swipe_up", "swipe_down", "open_url", "wait"
    )
}