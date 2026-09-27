package com.shakin.phoneagent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.net.Uri
import android.os.PowerManager
import android.speech.RecognizerIntent
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.ViewTreeObserver
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import android.graphics.drawable.GradientDrawable
import android.animation.ObjectAnimator
import android.view.animation.DecelerateInterpolator
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var root: FrameLayout
    private lateinit var contentScroll: ScrollView
    private lateinit var content: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var statusDetail: TextView
    private lateinit var statusDot: View
    private lateinit var chat: LinearLayout
    private lateinit var input: EditText
    private lateinit var keyInput: EditText
    private lateinit var keyButton: Button
    private lateinit var settingsPanel: LinearLayout
    private lateinit var confirmPanel: LinearLayout
    private lateinit var composer: LinearLayout
    private lateinit var liveStatus: TextView

    private var progressBubble: TextView? = null
    private var pulseAnimator: ObjectAnimator? = null
    private var keyboardWatcher: ViewTreeObserver.OnGlobalLayoutListener? = null

    private val bg = Color.rgb(255, 247, 251)
    private val card = Color.WHITE
    private val pink = Color.rgb(255, 91, 145)
    private val pinkDark = Color.rgb(224, 54, 111)
    private val pinkSofter = Color.rgb(255, 241, 246)
    private val textColor = Color.rgb(52, 35, 43)
    private val muted = Color.rgb(128, 102, 112)
    private val border = Color.rgb(244, 218, 229)
    private val green = Color.rgb(83, 189, 125)
    private val orange = Color.rgb(255, 173, 94)
    private val voiceRequestCode = 991
    private val composerBottomMargin = 12

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            window.statusBarColor = Color.WHITE
            window.navigationBarColor = Color.WHITE
            @Suppress("DEPRECATION")
            window.setSoftInputMode(
                WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
                    WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
            )

            if (Build.VERSION.SDK_INT >= 23) {
                @Suppress("DEPRECATION")
                var flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                if (Build.VERSION.SDK_INT >= 26) {
                    flags = flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
                }
                window.decorView.systemUiVisibility = flags
            }

            buildUi()
            installKeyboardWatcher()
            maybeStartSavedRuntime()
            refreshUiState()
        } catch (e: Throwable) {
            buildCrashSafeUi(e)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::root.isInitialized) refreshUiState()
    }

    override fun onDestroy() {
        keyboardWatcher?.let { root.viewTreeObserver.removeOnGlobalLayoutListener(it) }
        stopPulse()
        super.onDestroy()
    }

    private fun buildUi() {
        root = FrameLayout(this).apply {
            setBackgroundColor(bg)
            clipToPadding = false
        }

        contentScroll = ScrollView(this).apply {
            isFillViewport = true
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
            clipToPadding = false
            setPadding(dp(14), dp(10), dp(14), dp(110))
            background = pageBackground()
        }

        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        contentScroll.addView(content)
        root.addView(
            contentScroll,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        buildHeader()
        content.addView(space(10))
        content.addView(buildStatusCard())
        content.addView(space(10))
        content.addView(buildChatCard())
        content.addView(space(8))

        settingsPanel = buildSettingsPanel().apply { visibility = View.GONE }
        content.addView(settingsPanel)
        content.addView(space(7))

        confirmPanel = buildConfirmPanel().apply { visibility = View.GONE }
        content.addView(confirmPanel)
        content.addView(space(8))

        composer = buildComposer()
        val composerParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        ).apply {
            leftMargin = dp(12)
            rightMargin = dp(12)
            bottomMargin = dp(composerBottomMargin)
        }
        root.addView(composer, composerParams)

        setContentView(root)
    }

    private fun buildHeader() {
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(2), dp(3), dp(2), 0)
        }

        val logo = TextView(this).apply {
            text = "S"
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            background = rounded(pink, 19)
            elevation = dp(5).toFloat()
        }
        header.addView(logo, LinearLayout.LayoutParams(dp(48), dp(48)))

        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), 0, dp(7), 0)
        }

        titles.addView(TextView(this).apply {
            text = "Shakin Agent"
            textSize = 20f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
        })

        titles.addView(TextView(this).apply {
            text = "Your phone, controlled by your words"
            textSize = 10.5f
            setTextColor(muted)
            setPadding(0, dp(2), 0, 0)
        })

        header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))

        val statusPill = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(9), dp(7), dp(9), dp(7))
            background = strokeRounded(Color.WHITE, border, 999)
            elevation = dp(2).toFloat()
        }

        statusDot = View(this)
        statusPill.addView(statusDot, LinearLayout.LayoutParams(dp(8), dp(8)))

        statusText = TextView(this).apply {
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(pinkDark)
            setPadding(dp(6), 0, 0, 0)
        }
        statusPill.addView(statusText)
        header.addView(statusPill)

        content.addView(header)
    }

    private fun buildStatusCard(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = strokeRounded(Color.WHITE, border, 23)
            elevation = dp(2).toFloat()
        }

        val titleRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        titleRow.addView(TextView(this).apply {
            text = "●"
            textSize = 9f
            setTextColor(pink)
        })

        titleRow.addView(TextView(this).apply {
            text = "Agent activity"
            textSize = 13f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(7), 0, 0, 0)
        })

        liveStatus = TextView(this).apply {
            text = "Ready when you are."
            textSize = 10.5f
            setTextColor(muted)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        titleRow.addView(liveStatus, LinearLayout.LayoutParams(0, -2, 1f).also {
            it.setMargins(dp(9), 0, 0, 0)
        })

        box.addView(titleRow)

        statusDetail = TextView(this).apply {
            text = "Save a Groq key and enable Accessibility to get started."
            textSize = 10.5f
            setTextColor(muted)
            maxLines = 2
            setPadding(dp(15), dp(6), dp(4), 0)
        }
        box.addView(statusDetail)

        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        row.addView(
            pillButton("Accessibility") {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            },
            LinearLayout.LayoutParams(0, dp(39), 1f)
        )

        row.addView(spaceH(7))

        row.addView(
            primaryButton(
                if (AgentRuntimeService.isEnabled(this)) "Always On" else "Enable Background"
            ) {
                toggleAlwaysOn()
            },
            LinearLayout.LayoutParams(0, dp(39), 1f)
        )

        val row2 = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        row2.addView(
            pillButton("Keep Alive") {
                requestBatteryExemption()
            },
            LinearLayout.LayoutParams(0, dp(39), 1f)
        )

        row2.addView(spaceH(7))

        row2.addView(
            pillButton("Settings") {
                togglePanel(settingsPanel)
            },
            LinearLayout.LayoutParams(0, dp(39), 1f)
        )

        box.addView(space(8))
        box.addView(row)
        box.addView(space(7))
        box.addView(row2)
        return box
    }

    private fun buildChatCard(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = strokeRounded(card, border, 25)
            setPadding(dp(11), dp(12), dp(11), dp(10))
            elevation = dp(2).toFloat()
            minimumHeight = dp(300)
        }

        val heading = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        heading.addView(TextView(this).apply {
            text = "Conversation"
            textSize = 13f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
        })

        heading.addView(TextView(this).apply {
            text = "  Live"
            textSize = 10f
            setTextColor(pinkDark)
        })

        box.addView(heading)
        box.addView(space(5))

        chat = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }

        chat.addView(TextView(this).apply {
            text = "Try “Open YouTube”, “Open WhatsApp”, “Go home”, or describe a task."
            textSize = 11.5f
            setTextColor(muted)
            setPadding(dp(4), dp(4), dp(4), dp(8))
        })

        box.addView(chat)
        return box
    }

    private fun buildSettingsPanel(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = strokeRounded(Color.WHITE, border, 23)
            elevation = dp(2).toFloat()
        }

        box.addView(TextView(this).apply {
            text = "Groq Connection"
            textSize = 15f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
        })

        box.addView(TextView(this).apply {
            text = "Use your own key. It stays encrypted on this device."
            textSize = 10.5f
            setTextColor(muted)
            setPadding(0, dp(4), 0, dp(9))
        })

        val keyRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        keyInput = EditText(this).apply {
            setText(SecureStore(this@MainActivity).get())
            setTextColor(textColor)
            setHintTextColor(muted)
            hint = "Paste Groq API key"
            textSize = 13f
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            background = strokeRounded(pinkSofter, border, 17)
            setPadding(dp(12), 0, dp(12), 0)
        }

        keyButton = pillButton("Hide") {
            toggleKeyVisibility()
        }

        keyRow.addView(keyInput, LinearLayout.LayoutParams(0, dp(48), 1f))
        keyRow.addView(keyButton, LinearLayout.LayoutParams(dp(64), dp(48)).also {
            it.setMargins(dp(8), 0, 0, 0)
        })

        box.addView(keyRow)

        val buttons = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        buttons.addView(
            primaryButton("Save & Test") {
                saveAndTestKey()
            },
            LinearLayout.LayoutParams(0, dp(43), 1f)
        )

        buttons.addView(spaceH(8))

        buttons.addView(
            pillButton("Clear") {
                SecureStore(this@MainActivity).put("")
                keyInput.setText("")
                liveStatus.text = "Groq key cleared."
                refreshUiState()
            },
            LinearLayout.LayoutParams(0, dp(43), 1f)
        )

        box.addView(space(8))
        box.addView(buttons)
        return box
    }

    private fun buildConfirmPanel(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(13), dp(14), dp(13))
            background = strokeRounded(Color.rgb(255, 248, 231), Color.rgb(246, 220, 165), 22)
            elevation = dp(2).toFloat()
        }

        box.addView(TextView(this).apply {
            text = "Confirmation required"
            textSize = 14f
            setTextColor(Color.rgb(139, 93, 26))
            typeface = Typeface.DEFAULT_BOLD
        })

        box.addView(TextView(this).apply {
            text = "This action can send, call, delete, pay, or change account/security settings."
            textSize = 10.5f
            setTextColor(Color.rgb(122, 97, 61))
            setPadding(0, dp(4), 0, dp(8))
        })

        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        row.addView(
            primaryButton("Confirm") {
                confirmPanel.visibility = View.GONE
                animateOut(confirmPanel)
                showProgress("Completing the confirmed action…")
                PhoneAgentAccessibilityService.instance?.confirmPending { response ->
                    runOnUiThread { handleAgentResponse(response) }
                }
            },
            LinearLayout.LayoutParams(0, dp(42), 1f)
        )

        row.addView(spaceH(8))

        row.addView(
            pillButton("Cancel") {
                PhoneAgentAccessibilityService.instance?.cancelPending()
                confirmPanel.visibility = View.GONE
                addAgent("Cancelled.")
                liveStatus.text = "Ready when you are."
                refreshUiState()
            },
            LinearLayout.LayoutParams(0, dp(42), 1f)
        )

        box.addView(row)
        return box
    }

    private fun buildComposer(): LinearLayout {
        val wrap = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = strokeRounded(Color.WHITE, border, 24)
            setPadding(dp(7), dp(7), dp(7), dp(7))
            elevation = dp(7).toFloat()
        }

        input = EditText(this).apply {
            hint = "Tell your phone…"
            setHintTextColor(muted)
            setTextColor(textColor)
            textSize = 14f
            minHeight = dp(49)
            maxLines = 4
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(13), dp(10), dp(11), dp(10))
            background = rounded(pinkSofter, 18)
            isSingleLine = false
            setOnFocusChangeListener { _, focused ->
                if (focused) {
                    composer.animate()
                        .translationY(-dp(4).toFloat())
                        .setDuration(170)
                        .setInterpolator(DecelerateInterpolator())
                        .start()
                }
            }
        }

        wrap.addView(input, LinearLayout.LayoutParams(0, -2, 1f))

        wrap.addView(
            pillButton("Mic") { startVoiceInput() },
            LinearLayout.LayoutParams(dp(52), dp(49)).also {
                it.setMargins(dp(7), 0, 0, 0)
            }
        )

        wrap.addView(
            primaryButton("Send") { submitCurrent() },
            LinearLayout.LayoutParams(dp(66), dp(49)).also {
                it.setMargins(dp(7), 0, 0, 0)
            }
        )

        return wrap
    }

    private fun maybeStartSavedRuntime() {
        if (!AgentRuntimeService.isEnabled(this)) return
        runCatching { AgentRuntimeService.start(this) }
        requestNotificationPermissionIfNeeded()
    }

    private fun toggleAlwaysOn() {
        if (AgentRuntimeService.isEnabled(this)) {
            AgentRuntimeService.stop(this)
            liveStatus.text = "Background runtime stopped."
        } else {
            AgentRuntimeService.start(this)
            requestNotificationPermissionIfNeeded()
            liveStatus.text = "Always-on runtime enabled. The agent can keep working after you leave this screen."
        }
        refreshUiState()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) !=
                android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                requestPermissions(
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1201
                )
            }
        }
    }

    private fun requestBatteryExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            liveStatus.text = "Battery optimization controls are not available on this Android version."
            return
        }

        val power = getSystemService(PowerManager::class.java)
        if (power?.isIgnoringBatteryOptimizations(packageName) == true) {
            liveStatus.text = "Battery optimization is already disabled for Shakin Agent."
            return
        }

        try {
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName")
                )
            )
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun saveAndTestKey() {
        val key = keyInput.text.toString().trim()
        if (key.isBlank()) {
            liveStatus.text = "Paste your Groq API key first."
            return
        }

        if (!SecureStore(this).put(key)) {
            liveStatus.text = "Could not save the key securely."
            return
        }

        statusText.text = "Testing"
        statusDot.background = rounded(pink)
        liveStatus.text = "Checking the Groq connection…"
        startPulse(pink)

        Thread {
            val result = Planner.testApiKey(key)
            runOnUiThread {
                stopPulse()
                if (result == "Connected to Groq.") {
                    liveStatus.text = "Groq connected. Natural-language control is ready."
                    statusText.text = "Ready"
                    statusDot.background = rounded(green)
                    addAgent("Groq connected and your key was saved.")
                } else {
                    liveStatus.text = result
                    statusText.text = "Check key"
                    statusDot.background = rounded(Color.rgb(231, 135, 90))
                    addAgent(result)
                }
                refreshUiState()
            }
        }.start()
    }

    private fun toggleKeyVisibility() {
        val end = keyInput.selectionEnd
        val visible = keyInput.inputType ==
            (InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)

        if (visible) {
            keyInput.inputType =
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            keyInput.transformationMethod = PasswordTransformationMethod.getInstance()
            keyButton.text = "Show"
        } else {
            keyInput.inputType =
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            keyInput.transformationMethod = null
            keyButton.text = "Hide"
        }

        keyInput.setSelection(end.coerceAtLeast(0))
    }

    private fun submitCurrent() {
        val command = input.text.toString().trim()
        if (command.isBlank()) return

        input.setText("")
        addUser(command)

        val service = PhoneAgentAccessibilityService.instance
        if (service == null) {
            addAgent("Accessibility is off. Enable Shakin Agent in Android Accessibility settings.")
            return
        }

        showProgress("Understanding your request…")

        service.submit(
            command,
            { response ->
                runOnUiThread { handleAgentResponse(response) }
            },
            { progress ->
                runOnUiThread { showProgress(progress) }
            }
        )

        input.clearFocus()
        scrollContentBottom()
        refreshUiState()
    }

    private fun handleAgentResponse(raw: String) {
        finishProgress()

        try {
            val json = JSONObject(raw)
            if (json.optBoolean("requiresConfirmation", false)) {
                confirmPanel.visibility = View.VISIBLE
                animateIn(confirmPanel)
                addAgent(json.optString("message", "Please confirm this action."))
                scrollContentBottom()
                return
            }

            val error = json.optString("error")
            if (error.isNotBlank()) {
                addAgent("Error: " + error)
            } else {
                addAgent(json.optString("message", "Done."))
            }
        } catch (_: Exception) {
            addAgent(raw.ifBlank { "Done." })
        }

        scrollContentBottom()
        refreshUiState()
    }

    private fun showProgress(message: String) {
        if (message.isBlank()) return

        liveStatus.text = message
        statusText.text = "Working"
        statusDot.background = rounded(orange)
        startPulse(orange)

        val bubble = progressBubble
        if (bubble == null) {
            val created = TextView(this).apply {
                text = message
                textSize = 12.5f
                setTextColor(pinkDark)
                setPadding(dp(13), dp(11), dp(13), dp(11))
                background = strokeRounded(pinkSofter, border, 18)
                layoutParams = LinearLayout.LayoutParams(-2, -2).also {
                    it.gravity = Gravity.START
                    it.setMargins(0, dp(5), 0, dp(5))
                }
            }
            progressBubble = created
            chat.addView(created)
            animateIn(created)
        } else {
            bubble.text = message
            bubble.animate()
                .alpha(0.35f)
                .setDuration(80)
                .withEndAction {
                    bubble.animate().alpha(1f).setDuration(180).start()
                }
                .start()
        }

        scrollContentBottom()
    }

    private fun finishProgress() {
        progressBubble?.let { chat.removeView(it) }
        progressBubble = null
        stopPulse()
    }

    private fun refreshUiState() {
        val service = PhoneAgentAccessibilityService.instance
        val hasKey = SecureStore(this).get().isNotBlank()

        when {
            service?.isWorking() == true -> {
                statusText.text = "Working"
                statusDetail.text = liveStatus.text
                statusDot.background = rounded(orange)
                startPulse(orange)
            }

            service?.hasPendingConfirmation() == true -> {
                statusText.text = "Waiting"
                statusDetail.text = "Confirm the pending action below."
                statusDot.background = rounded(orange)
                stopPulse()
            }

            service != null && hasKey -> {
                statusText.text = if (AgentRuntimeService.isEnabled(this)) "Always On" else "Ready"
                statusDetail.text =
                    if (AgentRuntimeService.isEnabled(this)) {
                        "Groq + Accessibility active. Agent runtime stays alive in the background."
                    } else {
                        "Groq is configured and Accessibility is active."
                    }
                if (liveStatus.text.isNullOrBlank()) liveStatus.text = "Ready when you are."
                statusDot.background = rounded(green)
                stopPulse()
            }

            service != null -> {
                statusText.text = "Basic"
                statusDetail.text = "Simple phone commands work. Save a Groq key for natural language."
                statusDot.background = rounded(pink)
                stopPulse()
            }

            hasKey -> {
                statusText.text = "Key saved"
                statusDetail.text = "Groq key is saved. Enable Accessibility to control the phone."
                statusDot.background = rounded(Color.rgb(102, 164, 221))
                stopPulse()
            }

            else -> {
                statusText.text = "Setup"
                statusDetail.text = "Save a Groq key and enable Accessibility to get full control."
                statusDot.background = rounded(Color.rgb(204, 141, 164))
                stopPulse()
            }
        }
    }

    private fun addUser(message: String) = addBubble(message, true)
    private fun addAgent(message: String) = addBubble(message, false)

    private fun addBubble(message: String, user: Boolean) {
        val bubble = TextView(this).apply {
            text = message
            textSize = 13f
            setTextColor(if (user) Color.WHITE else textColor)
            setPadding(dp(13), dp(11), dp(13), dp(11))
            background = if (user) rounded(pink, 18) else strokeRounded(pinkSofter, border, 18)
            layoutParams = LinearLayout.LayoutParams(
                (resources.displayMetrics.widthPixels * 0.84f).toInt(),
                -2
            ).also {
                it.gravity = if (user) Gravity.END else Gravity.START
                it.setMargins(0, dp(5), 0, dp(5))
            }
            elevation = dp(1).toFloat()
        }

        chat.addView(bubble)
        animateIn(bubble)
        scrollContentBottom()
    }

    private fun scrollContentBottom() {
        contentScroll.post {
            contentScroll.fullScroll(View.FOCUS_DOWN)
        }
    }

    private fun togglePanel(panel: View) {
        if (panel.visibility == View.VISIBLE) {
            animateOut(panel)
            panel.postDelayed({ panel.visibility = View.GONE }, 170)
        } else {
            panel.visibility = View.VISIBLE
            animateIn(panel)
        }
        scrollContentBottom()
    }

    private fun animateIn(view: View) {
        view.alpha = 0f
        view.translationY = dp(8).toFloat()
        view.scaleX = 0.985f
        view.scaleY = 0.985f
        view.animate()
            .alpha(1f)
            .translationY(0f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(190)
            .setInterpolator(DecelerateInterpolator())
            .start()
    }

    private fun animateOut(view: View) {
        view.animate()
            .alpha(0f)
            .translationY(dp(7).toFloat())
            .setDuration(150)
            .setInterpolator(DecelerateInterpolator())
            .start()
    }

    private fun installKeyboardWatcher() {
        keyboardWatcher = ViewTreeObserver.OnGlobalLayoutListener {
            val rect = android.graphics.Rect()
            root.getWindowVisibleDisplayFrame(rect)
            val keyboardHeight = root.rootView.height - rect.bottom
            val keyboardOpen = keyboardHeight > dp(180)

            composer.animate()
                .translationY(if (keyboardOpen) -dp(5).toFloat() else 0f)
                .setDuration(180)
                .setInterpolator(DecelerateInterpolator())
                .start()
        }
        root.viewTreeObserver.addOnGlobalLayoutListener(keyboardWatcher)
    }

    private fun buildCrashSafeUi(error: Throwable) {
        val safeRoot = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(24), dp(24), dp(24), dp(24))
            background = pageBackground()
        }

        safeRoot.addView(TextView(this).apply {
            text = "Shakin Agent"
            textSize = 24f
            setTextColor(pinkDark)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        })

        safeRoot.addView(TextView(this).apply {
            text = "Startup error detected. This screen is safe and stays open."
            textSize = 13f
            setTextColor(muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(16))
        })

        safeRoot.addView(
            primaryButton("Open Accessibility settings") {
                try {
                    startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                } catch (_: Exception) {
                }
            },
            LinearLayout.LayoutParams(-1, dp(48))
        )

        safeRoot.addView(TextView(this).apply {
            text = error.message?.take(180) ?: "Unknown startup error"
            textSize = 9f
            setTextColor(muted)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, 0)
        })

        setContentView(safeRoot)
    }

    private fun startPulse(color: Int) {
        statusDot.background = rounded(color)
        if (pulseAnimator != null) return

        pulseAnimator = ObjectAnimator.ofFloat(statusDot, View.ALPHA, 0.45f, 1f).apply {
            duration = 720
            repeatCount = ObjectAnimator.INFINITE
            repeatMode = ObjectAnimator.REVERSE
            start()
        }
    }

    private fun stopPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = null
        if (::statusDot.isInitialized) statusDot.alpha = 1f
    }

    private fun primaryButton(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 11f
            isAllCaps = false
            setTextColor(Color.WHITE)
            background = rounded(pink, 17)
            setPadding(0, 0, 0, 0)
            setOnClickListener { onClick() }
            pressAnimation(this)
        }

    private fun pillButton(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 10.5f
            isAllCaps = false
            setTextColor(pinkDark)
            background = strokeRounded(Color.WHITE, border, 17)
            setPadding(0, 0, 0, 0)
            setOnClickListener { onClick() }
            pressAnimation(this)
        }

    private fun pressAnimation(view: View) {
        view.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    v.animate().scaleX(0.97f).scaleY(0.97f).setDuration(80).start()
                    false
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(100).start()
                    false
                }
                else -> false
            }
        }
    }

    private fun pageBackground(): GradientDrawable =
        GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(
                Color.WHITE,
                Color.rgb(255, 247, 251),
                Color.rgb(255, 242, 247)
            )
        )

    private fun rounded(color: Int, radiusDp: Int = 18): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
        }

    private fun strokeRounded(
        fill: Int,
        stroke: Int,
        radiusDp: Int
    ): GradientDrawable =
        GradientDrawable().apply {
            setColor(fill)
            setStroke(dp(1), stroke)
            cornerRadius = dp(radiusDp).toFloat()
        }

    private fun space(height: Int): View =
        Space(this).apply {
            layoutParams = LinearLayout.LayoutParams(1, height)
        }

    private fun spaceH(width: Int): View =
        Space(this).apply {
            layoutParams = LinearLayout.LayoutParams(width, 1)
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun startVoiceInput() {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Tell your phone what to do")
            }
            startActivityForResult(intent, voiceRequestCode)
        } catch (_: Exception) {
            addAgent("Voice input is not available on this device.")
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != voiceRequestCode || resultCode != RESULT_OK) return

        val value = data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            .orEmpty()

        if (value.isNotBlank()) {
            input.setText(value)
            input.setSelection(input.length())
            input.requestFocus()
        }
    }
}
