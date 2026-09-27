package com.shakin.phoneagent

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Path
import android.graphics.Rect
import android.media.AudioManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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

    @Volatile private var lastPackageName: String = ""

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event?.packageName?.toString()?.takeIf { it.isNotBlank() }?.let { lastPackageName = it }
    }

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

    fun submit(
        command: String,
        callback: (String) -> Unit,
        progressCallback: (String) -> Unit = {}
    ) {
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
                callbackOnMain(progressCallback, "Understanding your request…")
                val response = runAgent(clean, progressCallback)
                callbackOnMain(callback, response)
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

    private fun runAgent(
        command: String,
        progressCallback: (String) -> Unit
    ): String {
        val localChat = localChat(command)
        if (localChat != null) {
            callbackOnMain(progressCallback, "Replying…")
            return ok(localChat)
        }

        val local = localPlan(command)
        if (local != null) {
            if (local.risky || sensitive(command)) {
                pending = local
                callbackOnMain(progressCallback, "Confirmation required.")
                return confirmation(local.message)
            }
            return execute(local, progressCallback)
        }

        val apiKey = SecureStore(this).get()
        if (apiKey.isBlank()) {
            return error("Groq API key is not saved. Open Settings and tap Save & Test.")
        }

        var lastMessage = "Working…"

        repeat(24) {
            callbackOnMain(progressCallback, "Thinking about the next step…")

            val plan = Planner.next(command, snapshot(), launcherApps(), apiKey)
            lastMessage = plan.message

            if (plan.actions.isEmpty() || plan.done) {
                if (lastMessage.startsWith("Groq error:", true)) {
                    return error(lastMessage)
                }

                callbackOnMain(progressCallback, lastMessage.ifBlank { "Done." })
                return ok(lastMessage.ifBlank { "Done." })
            }

            if (plan.risky || sensitive(command)) {
                pending = plan
                callbackOnMain(progressCallback, "Confirmation required.")
                return confirmation(lastMessage.ifBlank { "Please confirm this action." })
            }

            val result = execute(plan, progressCallback)
            val parsed = JSONObject(result)
            if (parsed.optString("error").isNotBlank()) return result

            Thread.sleep(postBatchDelay(plan))
        }

        return ok(lastMessage.ifBlank { "Finished the available steps." })
    }

    private fun localChat(command: String): String? {
        val lower = command.trim().lowercase()
        return when {
            lower in setOf("hi", "hello", "hey", "yo", "hiya", "হাই", "হ্যালো") ->
                "Hi! I'm ready. Tell me what you want me to do on your phone."
            lower.contains("how are you") || lower.contains("কেমন আছ") ->
                "I'm ready and working. Give me a phone task or ask me anything."
            lower.contains("who are you") || lower.contains("তুমি কে") ->
                "I'm Shakin Agent — your phone-control assistant."
            lower.contains("what can you do") || lower.contains("কি করতে পার") ->
                "I can control visible phone UI, open apps, tap, type, scroll, navigate, and handle multi-step tasks."
            lower in setOf("thanks", "thank you", "ধন্যবাদ") ->
                "You're welcome."
            else -> null
        }
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

            lower == "notifications" || lower == "open notifications" ->
                Planner.Plan("Opening notifications.", listOf(Planner.Action("notifications")))

            lower == "quick settings" || lower == "open quick settings" ->
                Planner.Plan("Opening quick settings.", listOf(Planner.Action("quick_settings")))

            lower == "power menu" || lower == "open power menu" ->
                Planner.Plan("Opening the power menu.", listOf(Planner.Action("power_dialog")))

            lower == "lock phone" || lower == "lock screen" ->
                Planner.Plan(
                    "Locking the phone.",
                    listOf(Planner.Action("lock_screen")),
                    risky = true
                )

            lower == "volume up" || lower == "increase volume" ->
                Planner.Plan("Turning volume up.", listOf(Planner.Action("volume_up")))

            lower == "volume down" || lower == "decrease volume" ->
                Planner.Plan("Turning volume down.", listOf(Planner.Action("volume_down")))

            lower == "mute" || lower == "mute volume" ->
                Planner.Plan("Muting media volume.", listOf(Planner.Action("mute")))

            lower == "settings" || lower == "open settings" ->
                Planner.Plan("Opening Settings.", listOf(Planner.Action("open_settings")))

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

    private fun execute(
        plan: Planner.Plan,
        progressCallback: (String) -> Unit = {}
    ): String {
        return try {
            for (action in plan.actions) {
                callbackOnMain(progressCallback, actionProgress(action))

                when (action.type) {
                    "open_app" -> {
                        launchByLabel(action.arg)
                        waitForWindowReady()
                    }

                    "open_app_background" -> {
                        throw IllegalStateException(
                            "True background control is not available for this app because " +
                                "Android requires the target app's visible UI for Accessibility automation."
                        )
                    }

                    "tap_text" -> check(
                        tapTextRetry(action.arg),
                        "I could not find the visible control: " + action.arg
                    )

                    "tap_description" -> check(
                        tapDescriptionRetry(action.arg),
                        "I could not find that control."
                    )

                    "tap_coordinates" -> {
                        check(
                            action.x >= 0 && action.y >= 0,
                            "Tap coordinates are invalid."
                        )
                        tapCoordinates(action.x, action.y)
                    }

                    "long_press_text" -> check(
                        longPressText(action.arg),
                        "I could not find the visible control: " + action.arg
                    )

                    "type_text" -> check(
                        typeFocused(action.arg),
                        "No focused text field was found."
                    )

                    "clear_text" -> check(
                        typeFocused(""),
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

                    "notifications" -> check(
                        performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS),
                        "Could not open notifications."
                    )

                    "quick_settings" -> check(
                        performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS),
                        "Could not open quick settings."
                    )

                    "power_dialog" -> check(
                        performGlobalAction(GLOBAL_ACTION_POWER_DIALOG),
                        "Could not open the power menu."
                    )

                    "lock_screen" -> check(
                        performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN),
                        "Could not lock the screen."
                    )

                    "swipe" -> swipe(action.arg)

                    "scroll" -> scroll(action.arg)

                    "open_url" -> openUrl(action.arg)

                    "open_settings" -> openSettings()

                    "volume_up" -> changeVolume(AudioManager.ADJUST_RAISE)

                    "volume_down" -> changeVolume(AudioManager.ADJUST_LOWER)

                    "mute" -> changeVolume(AudioManager.ADJUST_MUTE)

                    "wait" -> Thread.sleep(action.ms.coerceIn(100L, 6000L))

                    else -> throw IllegalArgumentException("Unsupported action: " + action.type)
                }

                Thread.sleep(actionDelay(action.type))
            }

            ok(plan.message.ifBlank { "Done." })
        } catch (e: Exception) {
            error(e.message ?: "Action failed.")
        }
    }

    private fun actionProgress(action: Planner.Action): String =
        when (action.type) {
            "open_app" -> "Opening " + action.arg + "…"
            "open_app_background" -> "Opening " + action.arg + " in background…"
            "tap_text" -> "Tapping \"" + action.arg + "\"…"
            "tap_description" -> "Tapping control…"
            "tap_coordinates" -> "Tapping the screen…"
            "long_press_text" -> "Long-pressing \"" + action.arg + "\"…"
            "type_text" -> "Typing…"
            "clear_text" -> "Clearing the text field…"
            "back" -> "Going back…"
            "home" -> "Going home…"
            "recents" -> "Opening recent apps…"
            "notifications" -> "Opening notifications…"
            "quick_settings" -> "Opening quick settings…"
            "power_dialog" -> "Opening power menu…"
            "lock_screen" -> "Locking the phone…"
            "swipe" -> "Swiping " + action.arg + "…"
            "scroll" -> "Scrolling…"
            "open_url" -> "Opening the link…"
            "open_settings" -> "Opening Settings…"
            "volume_up" -> "Increasing volume…"
            "volume_down" -> "Decreasing volume…"
            "mute" -> "Muting media…"
            "wait" -> "Waiting…"
            else -> "Working…"
        }

    private fun actionDelay(type: String): Long =
        when (type) {
            "open_app", "open_app_background", "open_url", "open_settings" -> 950L
            "tap_text", "tap_description", "tap_coordinates", "long_press_text" -> 450L
            "type_text", "clear_text" -> 350L
            "swipe", "scroll" -> 500L
            else -> 300L
        }

    private fun postBatchDelay(plan: Planner.Plan): Long =
        if (plan.actions.any { it.type == "open_app" || it.type == "open_url" }) {
            1200L
        } else {
            500L
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
            val labelName = normalizeAppName(it.loadLabel(pm).toString())
            labelName.contains(target) || target.contains(labelName)
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

    private fun waitForWindowReady(timeoutMs: Long = 5000L) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val root = rootInActiveWindow
            if (root != null && root.childCount >= 0) {
                Thread.sleep(350)
                return
            }
            Thread.sleep(250)
        }
    }

    private fun packageFallback(target: String): String? = when {
        target == "youtube" || target == "yt" -> "com.google.android.youtube"
        target == "whatsapp" -> "com.whatsapp"
        target == "imo" -> "com.imo.android.imoim"
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

    private fun tapTextRetry(target: String): Boolean {
        repeat(4) {
            if (tapText(target)) return true
            Thread.sleep(550)
        }
        return false
    }

    private fun tapDescriptionRetry(target: String): Boolean {
        repeat(4) {
            if (tapDescription(target)) return true
            Thread.sleep(550)
        }
        return false
    }

    private fun tapText(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = findNodeSmart(root, target) ?: return false
        return clickNode(node)
    }

    private fun tapDescription(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = findNode(root, target, true) ?: findNodeSmart(root, target)
            ?: return false
        return clickNode(node)
    }

    private fun findNodeSmart(
        root: AccessibilityNodeInfo,
        target: String
    ): AccessibilityNodeInfo? {
        val exact = findNode(root, target, false)
        if (exact != null) return exact

        val normalizedTarget = normalizeUiText(target)

        fun walk(node: AccessibilityNodeInfo, depth: Int): AccessibilityNodeInfo? {
            if (depth > 18) return null

            val values = listOfNotNull(
                node.text?.toString(),
                node.contentDescription?.toString(),
                node.hintText?.toString()
            )

            val normalizedValues = values.map { normalizeUiText(it) }

            if (normalizedValues.any { it == normalizedTarget || it.contains(normalizedTarget) || normalizedTarget.contains(it) && it.length >= 3 }) {
                return node
            }

            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                val found = walk(child, depth + 1)
                if (found != null) return found
            }
            return null
        }

        return walk(root, 0)
    }

    private fun normalizeUiText(value: String): String =
        value.lowercase()
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()

    private fun longPressText(target: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val node = findNode(root, target, false) ?: return false
        val rect = Rect()
        node.getBoundsInScreen(rect)
        if (rect.isEmpty) return false
        return longPressCoordinates(rect.centerX(), rect.centerY())
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

        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }

        check(
            dispatchGesture(
                GestureDescription.Builder()
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 90))
                    .build(),
                null,
                main
            )
        ) { "Tap gesture failed." }

        Thread.sleep(220)
    }

    private fun longPressCoordinates(x: Int, y: Int): Boolean {
        val dm = resources.displayMetrics
        if (x !in 0 until dm.widthPixels || y !in 0 until dm.heightPixels) return false

        val path = Path().apply { moveTo(x.toFloat(), y.toFloat()) }

        return dispatchGesture(
            GestureDescription.Builder()
                .addStroke(GestureDescription.StrokeDescription(path, 0, 760))
                .build(),
            null,
            main
        )
    }

    private fun swipe(direction: String) {
        val dm = resources.displayMetrics
        val centerX = dm.widthPixels / 2f
        val centerY = dm.heightPixels / 2f

        val start: Pair<Float, Float>
        val end: Pair<Float, Float>

        when (direction.lowercase()) {
            "up" -> {
                start = centerX to dm.heightPixels * .80f
                end = centerX to dm.heightPixels * .20f
            }
            "down" -> {
                start = centerX to dm.heightPixels * .20f
                end = centerX to dm.heightPixels * .80f
            }
            "left" -> {
                start = dm.widthPixels * .84f to centerY
                end = dm.widthPixels * .16f to centerY
            }
            "right" -> {
                start = dm.widthPixels * .16f to centerY
                end = dm.widthPixels * .84f to centerY
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
                    .addStroke(GestureDescription.StrokeDescription(path, 0, 420))
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
            url.startsWith("http://", true) || url.startsWith("https://", true)
        ) { "Only http(s) URLs are supported." }

        startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun openSettings() {
        startActivity(
            Intent(Settings.ACTION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    private fun changeVolume(direction: Int) {
        val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            direction,
            AudioManager.FLAG_SHOW_UI
        )
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
            .take(280)
            .joinToString(", ")
    }

    private fun snapshot(): String {
        val root = rootInActiveWindow ?: return "(no visible UI)"
        val out = StringBuilder()

        out.append("package=")
            .append(root.packageName?.toString().orEmpty())
            .append('\n')

        fun walk(node: AccessibilityNodeInfo, depth: Int) {
            if (depth > 18 || out.length > 12_000) return

            val values = listOfNotNull(
                node.text?.toString(),
                node.contentDescription?.toString()
            )
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .distinct()

            if (values.isNotEmpty()) {
                val flags = buildString {
                    if (node.isClickable) append(" clickable")
                    if (node.isEditable) append(" editable")
                    if (node.isScrollable) append(" scrollable")
                    if (node.isCheckable) append(" checkable")
                    if (node.isChecked) append(" checked")
                }
                out.append(values.joinToString(" | "))
                    .append(flags)
                    .append('\n')
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
            .put("message", message.ifBlank { "Please confirm this action." })
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
