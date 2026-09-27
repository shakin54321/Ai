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
import java.util.concurrent.Executors

class PhoneAgentAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile var instance: PhoneAgentAccessibilityService? = null
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var pending: Planner.Plan? = null
    @Volatile private var working = false

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        pending = null
        executor.shutdownNow()
        super.onDestroy()
    }

    fun hasGroqKey(): Boolean = SecureStore(this).get().isNotBlank()
    fun isWorking(): Boolean = working
    fun hasPendingConfirmation(): Boolean = pending != null

    fun submit(command: String, callback: (String) -> Unit) {
        if (working) {
            main.post { callback(JSONObject().put("error", "Agent is already working on another task.").toString()) }
            return
        }

        executor.execute {
            working = true
            try {
                callbackOnMain(callback, runAgent(command, SecureStore(this).get()))
            } catch (e: Exception) {
                callbackOnMain(callback, JSONObject().put("error", e.message ?: "Agent failed.").toString())
            } finally {
                working = false
            }
        }
    }

    fun confirmPending(callback: (String) -> Unit) {
        val plan = pending ?: run {
            callback(JSONObject().put("error", "No action is waiting for confirmation.").toString())
            return
        }
        pending = null
        executor.execute {
            try {
                callbackOnMain(callback, execute(plan))
            } catch (e: Exception) {
                callbackOnMain(callback, JSONObject().put("error", e.message ?: "Action failed.").toString())
            }
        }
    }

    fun cancelPending(): String {
        pending = null
        return JSONObject().put("ok", true).put("message", "Cancelled.").toString()
    }

    private fun callbackOnMain(callback: (String) -> Unit, result: String) {
        main.post { callback(result) }
    }

    private fun runAgent(command: String, apiKey: String): String {
        if (command.isBlank()) return JSONObject().put("error", "Command is empty.").toString()

        if (apiKey.isBlank()) {
            val plan = Planner.next(command, snapshot(), apps(), "")
            if (plan.actions.isEmpty()) {
                return JSONObject().put("ok", true).put("message", plan.message).toString()
            }
            if (plan.risky || sensitive(command)) {
                pending = plan
                return JSONObject()
                    .put("ok", true)
                    .put("requiresConfirmation", true)
                    .put("message", plan.message)
                    .toString()
            }
            return execute(plan)
        }

        var lastMessage = "Working…"

        repeat(12) {
            val plan = Planner.next(command, snapshot(), apps(), apiKey)
            lastMessage = plan.message

            if (plan.actions.isEmpty() || plan.done) {
                return JSONObject().put("ok", true).put("message", lastMessage).toString()
            }

            if (plan.risky || sensitive(command)) {
                pending = plan
                return JSONObject()
                    .put("ok", true)
                    .put("requiresConfirmation", true)
                    .put("message", lastMessage.ifBlank { "Please confirm this sensitive action." })
                    .toString()
            }

            val result = execute(plan)
            val parsed = JSONObject(result)
            if (parsed.optString("error").isNotBlank()) return result
            Thread.sleep(350)
        }

        return JSONObject()
            .put("ok", true)
            .put("message", lastMessage.ifBlank { "Finished the available steps." })
            .toString()
    }

    private fun sensitive(command: String): Boolean =
        Regex("(?i)\\b(send|message|call|delete|remove|buy|purchase|pay|transfer|password|security|logout|uninstall|reset|shutdown)\\b")
            .containsMatchIn(command)

    private fun execute(plan: Planner.Plan): String {
        return try {
            for (action in plan.actions) {
                when (action.type) {
                    "open_app" -> launchByLabel(action.arg)
                    "tap_text" -> check(tapText(action.arg), "Could not find '" + action.arg + "'.")
                    "type_text" -> check(typeFocused(action.arg), "No focused text field.")
                    "tap_description" -> check(tapDescription(action.arg), "Could not find the requested control.")
                    "tap_coordinates" -> {
                        val parts = action.arg.split(",")
                        check(parts.size == 2, "Tap coordinates must be x,y.")
                        tapCoordinates(parts[0].trim().toInt(), parts[1].trim().toInt())
                    }
                    "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
                    "swipe" -> swipe(action.arg)
                    "scroll" -> swipe(if (action.arg.equals("backward", true)) "down" else "up")
                    "wait" -> Thread.sleep(action.ms.coerceIn(50L, 5000L))
                    "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
                    "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
                    "swipe_up" -> swipe(true)
                    "swipe_down" -> swipe(false)
                    "open_url" -> startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse(action.arg))
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }
                Thread.sleep(220)
            }
            JSONObject().put("ok", true).put("message", if (plan.message.isBlank()) "Done." else plan.message).toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "Action failed.").toString()
        }
    }

    private fun check(ok: Boolean, message: String) {
        if (!ok) throw IllegalStateException(message)
    }

    private fun launchByLabel(label: String) {
        val target = label.trim().lowercase()
        val pm = packageManager
        val app = pm.getInstalledApplications(0).firstOrNull {
            pm.getApplicationLabel(it).toString().lowercase().contains(target)
        } ?: throw IllegalArgumentException("App not found: $label")

        val launchIntent = pm.getLaunchIntentForPackage(app.packageName)
            ?: throw IllegalArgumentException("App cannot be opened: $label")
        startActivity(launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun tapDescription(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = find(root, target.lowercase(), true) ?: return false
        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (rect.isEmpty) return false
        tapCoordinates(rect.centerX(), rect.centerY())
        return true
    }

    private fun tapCoordinates(x: Int, y: Int) {
        val dm = resources.displayMetrics
        require(x in 0 until dm.widthPixels && y in 0 until dm.heightPixels) {
            "Tap coordinate is outside the screen."
        }
        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }
        check(
            dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 90))
                    .build(),
                null,
                main
            )
        ) { "Gesture could not be dispatched." }
        Thread.sleep(220)
    }

    private fun swipe(direction: String) {
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val startY = if (direction.equals("up", true)) dm.heightPixels * .76f else dm.heightPixels * .24f
        val endY = if (direction.equals("up", true)) dm.heightPixels * .24f else dm.heightPixels * .76f
        val path = Path().apply {
            moveTo(x, startY)
            lineTo(x, endY)
        }
        check(
            dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 420))
                    .build(),
                null,
                main
            )
        ) { "Swipe could not be dispatched." }
        Thread.sleep(500)
    }

    private fun find(node: AccessibilityNodeInfo, target: String, description: Boolean): AccessibilityNodeInfo? {
        val value = if (description) {
            node.contentDescription?.toString().orEmpty()
        } else {
            node.text?.toString().orEmpty()
        }
        if (value.lowercase().contains(target)) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = find(child, target, description)
            if (found != null) return found
        }
        return null
    }

    private fun tapText(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = find(root, target.lowercase()) ?: return false
        if (node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true

        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)
        val path = Path().apply {
            moveTo(rect.centerX().toFloat(), rect.centerY().toFloat())
        }
        return dispatchGesture(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 90))
                .build(),
            null,
            main
        )
    }

    private fun find(node: AccessibilityNodeInfo, target: String): AccessibilityNodeInfo? {
        val text = node.text?.toString().orEmpty()
        val desc = node.contentDescription?.toString().orEmpty()
        if ("$text $desc".lowercase().contains(target)) return node

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = find(child, target)
            if (found != null) return found
        }
        return null
    }

    private fun typeFocused(value: String): Boolean {
        val node = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        val args = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                value
            )
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun swipe(up: Boolean) {
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val from = if (up) dm.heightPixels * .74f else dm.heightPixels * .26f
        val to = if (up) dm.heightPixels * .26f else dm.heightPixels * .74f

        val path = Path().apply {
            moveTo(x, from)
            lineTo(x, to)
        }
        dispatchGesture(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 420))
                .build(),
            null,
            main
        )
    }

    private fun snapshot(): String {
        val root = rootInActiveWindow ?: return ""
        val out = StringBuilder()

        fun walk(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > 12 || out.length > 9000) return
            listOfNotNull(node.text?.toString(), node.contentDescription?.toString())
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .distinct()
                .forEach { out.append(it).append('\n') }

            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { walk(it, depth + 1) }
            }
        }

        walk(root, 0)
        return out.toString()
    }

    private fun apps(): String = packageManager.getInstalledApplications(0)
        .map { packageManager.getApplicationLabel(it).toString() }
        .filter { it.isNotBlank() }
        .distinct()
        .sorted()
        .take(180)
        .joinToString(", ")
}