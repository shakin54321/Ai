package com.shakin.phoneagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Intent
import android.graphics.Path
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors

class PhoneAgentAccessibilityService : AccessibilityService() {
    private val executor = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())
    private var server: ServerSocket? = null
    @Volatile private var pending: Planner.Plan? = null
    @Volatile private var cloudThread: Thread? = null
    private val cloudBase = "https://shakin-agent.hatchable.site"

    override fun onServiceConnected() {
        super.onServiceConnected()
        executor.execute {
            try {
                server = ServerSocket(8787, 16, InetAddress.getLoopbackAddress())
                while (server?.isClosed == false) {
                    executor.execute { handle(server!!.accept()) }
                }
            } catch (_: Exception) {}
        }
        cloudThread?.interrupt()
        cloudThread = Thread { cloudLoop() }.also { it.start() }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onDestroy() {
        try { server?.close() } catch (_: Exception) {}
        cloudThread?.interrupt()
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun cloudLoop() {
        while (!Thread.currentThread().isInterrupted) {
            try {
                val command = pollCloud()
                Thread.sleep(if (command) 450L else 1800L)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            } catch (_: Exception) {
                try { Thread.sleep(4000L) } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            }
        }
    }

    private fun tokenHash(value: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    private fun cloudRequest(path: String, body: JSONObject): JSONObject {
        val connection = (URL(cloudBase + path).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 10000
            readTimeout = 15000
            setRequestProperty("Content-Type", "application/json")
        }
        return try {
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.readText().orEmpty()
            if (text.isBlank()) JSONObject().put("error", "Empty cloud response") else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun pollCloud(): Boolean {
        val t = token()
        if (t.isBlank()) return false
        val response = cloudRequest("/api/agent/poll", JSONObject().put("token", t))
        val command = response.optJSONObject("command") ?: return false
        val id = command.optLong("id", 0L)
        val kind = command.optString("kind", "command")
        if (id <= 0L) return false

        val result = when (kind) {
            "command" -> {
                val text = command.optString("command", "").trim()
                if (text.isBlank()) {
                    JSONObject().put("error", "Empty command")
                } else {
                    JSONObject(process(text))
                }
            }
            "confirm" -> {
                val plan = pending
                pending = null
                if (plan == null) {
                    JSONObject().put("error", "No pending action")
                } else {
                    JSONObject(execute(plan))
                }
            }
            "cancel" -> {
                pending = null
                JSONObject().put("ok", true).put("message", "Cancelled.")
            }
            else -> JSONObject().put("error", "Unknown cloud action")
        }

        cloudRequest(
            "/api/agent/respond",
            JSONObject()
                .put("token", t)
                .put("id", id)
                .put("result", result)
        )
        return true
    }

    private fun token() = getSharedPreferences("agent", MODE_PRIVATE).getString("token", "") ?: ""
    private fun groqKey() = getSharedPreferences("agent", MODE_PRIVATE).getString("groq", "") ?: ""

    private fun handle(socket: Socket) {
        socket.use {
            try {
                val r = BufferedReader(InputStreamReader(socket.getInputStream(), Charsets.UTF_8))
                val request = r.readLine() ?: return
                val parts = request.split(" ")
                val method = parts.getOrNull(0) ?: "GET"
                val path = parts.getOrNull(1)?.substringBefore("?") ?: "/"
                val headers = HashMap<String, String>()
                while (true) {
                    val line = r.readLine() ?: break
                    if (line.isEmpty()) break
                    val i = line.indexOf(':')
                    if (i > 0) headers[line.substring(0, i).lowercase()] = line.substring(i + 1).trim()
                }
                val len = headers["content-length"]?.toIntOrNull() ?: 0
                val body = buildString { repeat(len) { append(r.read().toChar()) } }
                val result = route(method, path, headers, body)
                val bytes = result.toByteArray(Charsets.UTF_8)
                val head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: Content-Type, X-Agent-Token\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
                socket.getOutputStream().apply { write(head.toByteArray()); write(bytes); flush() }
            } catch (_: Exception) {}
        }
    }

    private fun route(method: String, path: String, headers: Map<String,String>, body: String): String {
        if (method == "OPTIONS") return JSONObject().put("ok", true).toString()
        if (headers["x-agent-token"] != token()) return JSONObject().put("error", "Invalid token").toString()
        return when {
            method == "GET" && path == "/v1/status" ->
                JSONObject().put("ok", true).put("accessibility", true).put("hasGroq", groqKey().isNotBlank()).toString()
            method == "POST" && path == "/v1/cancel" -> { pending = null; JSONObject().put("ok", true).put("message", "Cancelled.").toString() }
            method == "POST" && path == "/v1/confirm" -> {
                val p = pending ?: return JSONObject().put("error", "No pending action").toString()
                pending = null
                execute(p)
            }
            method == "POST" && path == "/v1/command" -> {
                val command = JSONObject(body).optString("command").trim()
                if (command.isBlank()) JSONObject().put("error", "Command is empty").toString() else process(command)
            }
            else -> JSONObject().put("error", "Not found").toString()
        }
    }

    private fun process(command: String): String {
        val plan = Planner.plan(command, snapshot(), apps(), groqKey())
        if (plan.actions.isEmpty()) return JSONObject().put("ok", true).put("message", plan.message).toString()
        val sensitive = Regex(
            "(?i)\\b(send|message|call|delete|remove|buy|purchase|pay|transfer|password|security|logout|uninstall|reset|shutdown)\\b"
        ).containsMatchIn(command)
        if (plan.risky || sensitive) {
            pending = plan
            return JSONObject().put("ok", true)
                .put("requiresConfirmation", true)
                .put("message", if (plan.message.isBlank()) "Please confirm this sensitive action." else plan.message)
                .toString()
        }
        return execute(plan)
    }

    private fun execute(plan: Planner.Plan): String {
        return try {
            plan.actions.forEach { action ->
                when (action.type) {
                    "open_app" -> launchByLabel(action.arg)
                    "tap_text" -> check(tapText(action.arg), "Could not find ${action.arg}")
                    "type_text" -> check(typeFocused(action.arg), "No focused text field")
                    "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
                    "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
                    "swipe_up" -> swipe(true)
                    "swipe_down" -> swipe(false)
                    "open_url" -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(action.arg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                    "wait" -> Thread.sleep(action.ms.coerceIn(50, 3000))
                }
                Thread.sleep(180)
            }
            JSONObject().put("ok", true).put("message", if (plan.message.isBlank()) "Done." else plan.message).toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "Action failed").toString()
        }
    }

    private fun check(ok: Boolean, message: String) { if (!ok) throw IllegalStateException(message) }

    private fun launchByLabel(label: String) {
        val pm = packageManager
        val q = label.lowercase()
        val app = pm.getInstalledApplications(0).firstOrNull { pm.getApplicationLabel(it).toString().lowercase().contains(q) }
            ?: throw IllegalArgumentException("App not found: $label")
        val intent = pm.getLaunchIntentForPackage(app.packageName) ?: throw IllegalArgumentException("App cannot be opened: $label")
        startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun tapText(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = find(root, target.lowercase()) ?: return false
        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)
        val path = Path().apply { moveTo(rect.centerX().toFloat(), rect.centerY().toFloat()) }
        return dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 90)).build(), null, main)
    }

    private fun find(node: AccessibilityNodeInfo, target: String): AccessibilityNodeInfo? {
        val value = listOfNotNull(node.text?.toString(), node.contentDescription?.toString()).joinToString(" ").lowercase()
        if (value.contains(target)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = find(child, target)
            if (found != null) return found
        }
        return null
    }

    private fun typeFocused(value: String): Boolean {
        val node = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun swipe(up: Boolean) {
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val from = if (up) dm.heightPixels * .72f else dm.heightPixels * .28f
        val to = if (up) dm.heightPixels * .28f else dm.heightPixels * .72f
        val path = Path().apply { moveTo(x, from); lineTo(x, to) }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, 420)).build(), null, main)
    }

    private fun snapshot(): String {
        val root = rootInActiveWindow ?: return ""
        val out = StringBuilder()
        fun walk(n: AccessibilityNodeInfo, depth: Int) {
            if (depth > 10 || out.length > 6000) return
            listOfNotNull(n.text?.toString(), n.contentDescription?.toString()).distinct().forEach { out.append(it).append('\n') }
            for (i in 0 until n.childCount) n.getChild(i)?.let { walk(it, depth + 1) }
        }
        walk(root, 0)
        return out.toString()
    }

    private fun apps(): String = packageManager.getInstalledApplications(0)
        .map { packageManager.getApplicationLabel(it).toString() }.distinct().sorted().take(100).joinToString(", ")
}