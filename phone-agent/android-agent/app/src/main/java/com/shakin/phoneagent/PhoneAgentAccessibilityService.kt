package com.shakin.phoneagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Path
import android.graphics.Rect
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
        val clean = command.trim()
        if (clean.isBlank()) {
            main.post { callback(error("Tell me what you want me to do.")) }
            return
        }
        if (working) {
            main.post { callback(error("I'm already working on another task.")) }
            return
        }

        executor.execute {
            working = true
            try {
                callbackOnMain(callback, runAgent(clean))
            } catch (e: Exception) {
                callbackOnMain(callback, error(e.message ?: "Agent failed."))
            } finally {
                working = false
            }
        }
    }

    fun confirmPending(callback: (String) -> Unit) {
        val plan = pending ?: run {
            main.post { callback(error("There is no action waiting for confirmation.")) }
            return
        }

        pending = null
        executor.execute {
            working = true
            try {
                callbackOnMain(callback, execute(plan))
            } catch (e: Exception) {
                callbackOnMain(callback, error(e.message ?: "Action failed."))
            } finally {
                working = false
            }
        }
    }

    fun cancelPending(): String {
        pending = null
        return ok("Cancelled.")
    }

    private fun runAgent(command: String): String {
        val local = localPlan(command)

        if (local != null) {
            if (local.risky || sensitive(command)) {
                pending = local
                return confirmation(local.message)
            }
            return execute(local)
        }

        val apiKey = SecureStore(this).get()
        if (apiKey.isBlank()) {
            return error("Groq API key is not saved. Open Settings and tap Save & Test.")
        }

        var lastMessage = "Working…"

        repeat(18) {
            val plan = Planner.next(command, snapshot(), launcherApps(), apiKey)
            lastMessage = plan.message

            if (plan.actions.isEmpty() || plan.done) {
                return if (lastMessage.startsWith("Groq error:", true)) {
                    error(lastMessage)
                } else {
                    ok(lastMessage.ifBlank { "Done." })
                }
            }

            if (plan.risky || sensitive(command)) {
                pending = plan
                return confirmation(lastMessage.ifBlank { "Please confirm this action." })
            }

            val result = execute(plan)
            val parsed = JSONObject(result)
            if (parsed.optString("error").isNotBlank()) return result

            Thread.sleep(350)
        }

        return ok(lastMessage.ifBlank { "Finished the available steps." })
    }

    private fun localPlan(command: String): Planner.Plan? {
        val raw = command.trim()
        val lower = raw.lowercase()

        return when {
            lower == "home" || lower == "go home" ->
                Planner.Plan("Going home.", listOf(Planner.Action("home")))

            lower == "back" || lower == "go back" ->
                Planner.Plan("Going back.", listOf(Planner.Action("back")))

            lower == "recents" || lower == "open recents" ->
                Planner.Plan("Opening Recents.", listOf(Planner.Action("recents")))

            lower.startsWith("open http://") || lower.startsWith("open https://") ->
                Planner.Plan(
                    "Opening the link.",
                    listOf(Planner.Action("open_url", raw.substringAfter(' ')))
                )

            lower.startsWith("open ") || lower.startsWith("launch ") ->
                Planner.Plan(
                    "Opening " + raw.substringAfter(' ') + ".",
                    listOf(Planner.Action("open_app", raw.substringAfter(' ')))
                )

            lower.startsWith("tap ") || lower.startsWith("press ") ->
                Planner.Plan(
                    "Tapping " + raw.substringAfter(' ') + ".",
                    listOf(Planner.Action("tap_text", raw.substringAfter(' ')))
                )

            lower.startsWith("type ") || lower.startsWith("write ") ->
                Planner.Plan(
                    "Typing the text.",
                    listOf(Planner.Action("type_text", raw.substringAfter(' ')))
                )

            lower == "scroll up" || lower == "swipe up" ->
                Planner.Plan("Scrolling up.", listOf(Planner.Action("swipe", "up")))

            lower == "scroll down" || lower == "swipe down" ->
                Planner.Plan("Scrolling down.", listOf(Planner.Action("swipe", "down")))

            else -> null
        }
    }

    private fun execute(plan: Planner.Plan): String {
        return try {
            for (action in plan.actions) {
                when (action.type) {
                    "open_app" -> launchByLabel(action.arg)

                    "tap_text" -> check(
                        tapText(action.arg),
                        "I could not find the visible control: " + action.arg
                    )

                    "tap_description" -> check(
                        tapDescription(action.arg),
                        "I could not find that control."
                    )

                    "tap_coordinates" -> {
                        val parts = action.arg.split(",")
                        check(parts.size == 2, "Tap coordinates are invalid.")
                        tapCoordinates(
                            parts[0].trim().toInt(),
                            parts[1].trim().toInt()
                        )
                    }

                    "type_text" -> check(
                        typeFocused(action.arg),
                        "No focused text field was found."
                    )

                    "back" -> check(
                        performGlobalAction(GLOBAL_ACTION_BACK),
                        "Back action failed."
                    )

                    "home" -> check(
                        performGlobalAction(GLOBAL_ACTION_HOME),
                        "Home action failed."
                    )

                    "recents" -> check(
                        performGlobalAction(GLOBAL_ACTION_RECENTS),
                        "Recents action failed."
                    )

                    "swipe" -> swipe(action.arg)

                    "scroll" -> scroll(action.arg)

                    "open_url" -> openUrl(action.arg)

                    "wait" -> Thread.sleep(action.ms.coerceIn(50L, 5000L))
                }

                Thread.sleep(260)
            }

            ok(plan.message.ifBlank { "Done." })
        } catch (e: Exception) {
            error(e.message ?: "Action failed.")
        }
    }

    private fun launchByLabel(label: String) {
        val target = normalizeAppName(label)
        require(target.isNotBlank()) { "App name is empty." }

        val pm = packageManager
        val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }

        val activities = pm.queryIntentActivities(
            launcherIntent,
            PackageManager.MATCH_ALL
        )

        val exact = activities.firstOrNull {
            normalizeAppName(it.loadLabel(pm).toString()) == target
        }

        val partial = activities.firstOrNull {
            normalizeAppName(it.loadLabel(pm).toString()).contains(target) ||
                target.contains(normalizeAppName(it.loadLabel(pm).toString()))
        }

        val chosen = exact ?: partial

        if (chosen != null) {
            startActivity(
                Intent(Intent.ACTION_MAIN).apply {
                    addCategory(Intent.CATEGORY_LAUNCHER)
                    component = ComponentName(
                        chosen.activityInfo.packageName,
                        chosen.activityInfo.name
                    )
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
            return
        }

        val packageFallback = packageFallback(target)
        if (packageFallback != null) {
            val launch = pm.getLaunchIntentForPackage(packageFallback)
            if (launch != null) {
                startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            }
        }

        throw IllegalArgumentException("App not found: " + label)
    }

    private fun packageFallback(target: String): String? = when {
        target == "youtube" || target == "yt" -> "com.google.android.youtube"
        target == "whatsapp" -> "com.whatsapp"
        target == "telegram" -> "org.telegram.messenger"
        target == "chrome" || target == "google chrome" -> "com.android.chrome"
        target == "instagram" -> "com.instagram.android"
        target == "facebook" -> "com.facebook.katana"
        else -> null
    }

    private fun normalizeAppName(value: String): String =
        value.trim().lowercase()
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()

    private fun tapText(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = findNode(root, target, false) ?: return false
        return clickNode(node)
    }

    private fun tapDescription(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = findNode(root, target, true) ?: return false
        return clickNode(node)
    }

    private fun findNode(
        node: AccessibilityNodeInfo,
        target: String,
        descriptionOnly: Boolean
    ): AccessibilityNodeInfo? {
        val needle = target.trim().lowercase()
        if (needle.isBlank()) return null

        val value = if (descriptionOnly) {
            node.contentDescription?.toString().orEmpty()
        } else {
            listOfNotNull(
                node.text?.toString(),
                node.contentDescription?.toString()
            ).joinToString(" ")
        }

        if (value.lowercase().contains(needle)) return node

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findNode(child, target, descriptionOnly)
            if (found != null) return found
        }

        return null
    }

    private fun clickNode(node: AccessibilityNodeInfo): Boolean {
        if (node.isClickable && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            return true
        }

        var parent = node.parent
        while (parent != null) {
            if (parent.isClickable && parent.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
                return true
            }
            parent = parent.parent
        }

        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (rect.isEmpty) return false

        tapCoordinates(rect.centerX(), rect.centerY())
        return true
    }

    private fun typeFocused(value: String): Boolean {
        val field = rootInActiveWindow?.findFocus(
            AccessibilityNodeInfo.FOCUS_INPUT
        ) ?: return false

        val args = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                value
            )
        }

        return field.performAction(
            AccessibilityNodeInfo.ACTION_SET_TEXT,
            args
        )
    }

    private fun tapCoordinates(x: Int, y: Int) {
        val dm = resources.displayMetrics
        require(x in 0 until dm.widthPixels && y in 0 until dm.heightPixels) {
            "Tap coordinate is outside the screen."
        }

        val path = Path().apply {
            moveTo(x.toFloat(), y.toFloat())
        }

        check(
            dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(
                        GestureDescription.StrokeDescription(path, 0, 90)
                    )
                    .build(),
                null,
                main
            )
        ) { "Tap gesture failed." }

        Thread.sleep(220)
    }

    private fun swipe(direction: String) {
        val dm = resources.displayMetrics
        val centerX = dm.widthPixels / 2f
        val centerY = dm.heightPixels / 2f

        val start: Pair<Float, Float>
        val end: Pair<Float, Float>

        when (direction.lowercase()) {
            "up" -> {
                start = centerX to dm.heightPixels * .78f
                end = centerX to dm.heightPixels * .22f
            }
            "down" -> {
                start = centerX to dm.heightPixels * .22f
                end = centerX to dm.heightPixels * .78f
            }
            "left" -> {
                start = dm.widthPixels * .82f to centerY
                end = dm.widthPixels * .18f to centerY
            }
            "right" -> {
                start = dm.widthPixels * .18f to centerY
                end = dm.widthPixels * .82f to centerY
            }
            else -> throw IllegalArgumentException("Invalid swipe direction.")
        }

        val path = Path().apply {
            moveTo(start.first, start.second)
            lineTo(end.first, end.second)
        }

        check(
            dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(
                        GestureDescription.StrokeDescription(path, 0, 420)
                    )
                    .build(),
                null,
                main
            )
        ) { "Swipe failed." }

        Thread.sleep(500)
    }

    private fun scroll(direction: String) {
        val root = rootInActiveWindow
            ?: throw IllegalStateException("No visible screen.")

        val action = if (direction.equals("backward", true)) {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }

        if (!performScroll(root, action)) {
            swipe(if (direction.equals("backward", true)) "down" else "up")
        }
    }

    private fun performScroll(node: AccessibilityNodeInfo, action: Int): Boolean {
        if (node.isScrollable && node.performAction(action)) return true

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            if (performScroll(child, action)) return true
        }

        return false
    }

    private fun openUrl(url: String) {
        require(
            url.startsWith("http://", true) ||
                url.startsWith("https://", true)
        ) { "Only http(s) URLs are supported." }

        main.post {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        }
    }

    private fun launcherApps(): String {
        val intent = Intent(Intent.ACTION_MAIN).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }

        return packageManager
            .queryIntentActivities(intent, PackageManager.MATCH_ALL)
            .map { it.loadLabel(packageManager).toString().trim() }
            .filter { it.isNotBlank() }
            .distinct()
            .sorted()
            .take(220)
            .joinToString(", ")
    }

    private fun snapshot(): String {
        val root = rootInActiveWindow ?: return "(no visible UI)"
        val out = StringBuilder()

        out.append("package=")
            .append(root.packageName?.toString().orEmpty())
            .append('\n')

        fun walk(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > 15 || out.length > 9000) return

            val values = listOfNotNull(
                node.text?.toString(),
                node.contentDescription?.toString()
            )
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .distinct()

            if (values.isNotEmpty()) {
                out.append(values.joinToString(" | ")).append('\n')
            }

            for (i in 0 until node.childCount) {
                node.getChild(i)?.let { walk(it, depth + 1) }
            }
        }

        walk(root, 0)
        return out.toString()
    }

    private fun sensitive(command: String): Boolean =
        Regex(
            "(?i)\\b(send|message|post|publish|call|dial|delete|remove|buy|purchase|pay|transfer|password|passcode|otp|security|logout|uninstall|reset|shutdown|factory reset)\\b"
        ).containsMatchIn(command)

    private fun confirmation(message: String): String =
        JSONObject()
            .put("ok", true)
            .put("requiresConfirmation", true)
            .put(
                "message",
                message.ifBlank { "Please confirm this action." }
            )
            .toString()

    private fun callbackOnMain(
        callback: (String) -> Unit,
        value: String
    ) {
        main.post { callback(value) }
    }

    private fun ok(message: String): String =
        JSONObject().put("ok", true).put("message", message).toString()

    private fun error(message: String): String =
        JSONObject().put("error", message).toString()

    private fun check(condition: Boolean, message: String) {
        if (!condition) throw IllegalStateException(message)
    }
}
