package com.shakin.phoneagent

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.view.Window
import android.view.WindowInsets
import android.view.WindowInsetsAnimation
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Space
import android.widget.TextView
import android.widget.FrameLayout
import android.graphics.drawable.GradientDrawable
import android.animation.ObjectAnimator
import android.view.animation.DecelerateInterpolator
import android.view.MotionEvent
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var root: LinearLayout
    private lateinit var statusText: TextView
    private lateinit var statusDetail: TextView
    private lateinit var statusDot: View
    private lateinit var chat: LinearLayout
    private lateinit var chatScroll: ScrollView
    private lateinit var input: EditText
    private lateinit var keyInput: EditText
    private lateinit var keyButton: Button
    private lateinit var settingsPanel: LinearLayout
    private lateinit var confirmPanel: LinearLayout
    private lateinit var composer: LinearLayout
    private lateinit var liveStatus: TextView

    private var progressBubble: TextView? = null
    private var pulseAnimator: ObjectAnimator? = null
    private val bg = Color.rgb(255, 247, 251)
    private val card = Color.WHITE
    private val pink = Color.rgb(255, 91, 145)
    private val pinkDark = Color.rgb(224, 54, 111)
    private val pinkSoft = Color.rgb(255, 229, 239)
    private val pinkSofter = Color.rgb(255, 241, 246)
    private val textColor = Color.rgb(52, 35, 43)
    private val muted = Color.rgb(128, 102, 112)
    private val border = Color.rgb(244, 218, 229)
    private val green = Color.rgb(83, 189, 125)
    private val orange = Color.rgb(255, 173, 94)
    private val voiceRequestCode = 991

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        window.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
                WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN
        )

        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(true)
            window.insetsController?.setSystemBarsAppearance(
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or
                    View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }

        buildUi()
        installInsetsAnimation()
        refreshUiState()
    }

    override fun onResume() {
        super.onResume()
        refreshUiState()
    }

    private fun buildUi() {
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(12))
            background = pageBackground()
        }

        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        val logo = TextView(this).apply {
            text = "S"
            textSize = 21f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            background = rounded(pink, 20)
            elevation = dp(5).toFloat()
        }
        header.addView(logo, LinearLayout.LayoutParams(dp(50), dp(50)))

        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
        }

        titles.addView(TextView(this).apply {
            text = "Shakin Agent"
            textSize = 20f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
        })
        titles.addView(TextView(this).apply {
            text = "Your phone, controlled by your words"
            textSize = 11f
            setTextColor(muted)
            setPadding(0, dp(2), 0, 0)
        })
        header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))

        val statusPill = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(7), dp(10), dp(7))
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

        root.addView(header)
        root.addView(space(10))

        root.addView(buildStatusCard())
        root.addView(space(10))

        chatScroll = ScrollView(this).apply {
            isFillViewport = true
            clipToPadding = false
            setPadding(0, 0, 0, dp(2))
            background = strokeRounded(card, border, 26)
            elevation = dp(3).toFloat()
        }

        chat = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(13), dp(15), dp(13), dp(16))
        }

        val welcome = TextView(this).apply {
            text = "Try “Open YouTube”, “Open WhatsApp”, “Go home”, or describe a multi-step task."
            textSize = 12f
            setTextColor(muted)
            setPadding(dp(5), dp(3), dp(5), dp(10))
            alpha = 0.9f
        }
        chat.addView(welcome)
        chatScroll.addView(chat)
        root.addView(chatScroll, LinearLayout.LayoutParams(-1, 0, 1f))

        root.addView(space(9))

        settingsPanel = buildSettingsPanel()
        settingsPanel.visibility = View.GONE
        root.addView(settingsPanel)
        root.addView(space(7))

        confirmPanel = buildConfirmPanel()
        confirmPanel.visibility = View.GONE
        root.addView(confirmPanel)
        root.addView(space(7))

        composer = buildComposer()
        root.addView(composer)

        setContentView(root)
    }

    private fun buildStatusCard(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(13), dp(15), dp(13))
            background = strokeRounded(Color.WHITE, border, 23)
            elevation = dp(2).toFloat()
        }

        val title = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        val spark = TextView(this).apply {
            text = "●"
            textSize = 9f
            setTextColor(pink)
        }
        title.addView(spark)

        title.addView(TextView(this).apply {
            text = "Agent activity"
            textSize = 13f
            setTextColor(textColor)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(7), 0, 0, 0)
        })

        liveStatus = TextView(this).apply {
            text = "Ready when you are."
            textSize = 11f
            setTextColor(muted)
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        }
        title.addView(liveStatus, LinearLayout.LayoutParams(0, -2, 1f).also {
            it.setMargins(dp(9), 0, 0, 0)
        })

        box.addView(title)

        val actionRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        val access = pillButton("Accessibility") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        actionRow.addView(access, LinearLayout.LayoutParams(0, dp(40), 1f))

        actionRow.addView(spaceH(7))

        val settings = pillButton("Settings") {
            togglePanel(settingsPanel)
        }
        actionRow.addView(settings, LinearLayout.LayoutParams(0, dp(40), 1f))

        box.addView(space(8))
        box.addView(actionRow)
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

        buttons.addView(primaryButton("Save & Test") {
            saveAndTestKey()
        }, LinearLayout.LayoutParams(0, dp(43), 1f))

        buttons.addView(spaceH(8))

        buttons.addView(pillButton("Clear") {
            SecureStore(this@MainActivity).put("")
            keyInput.setText("")
            liveStatus.text = "Groq key cleared."
            refreshUiState()
        }, LinearLayout.LayoutParams(0, dp(43), 1f))

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

        row.addView(primaryButton("Confirm") {
            confirmPanel.visibility = View.GONE
            animateOut(confirmPanel)
            showProgress("Completing the confirmed action…")
            PhoneAgentAccessibilityService.instance?.confirmPending { response ->
                runOnUiThread { handleAgentResponse(response) }
            }
        }, LinearLayout.LayoutParams(0, dp(42), 1f))

        row.addView(spaceH(8))

        row.addView(pillButton("Cancel") {
            PhoneAgentAccessibilityService.instance?.cancelPending()
            confirmPanel.visibility = View.GONE
            addAgent("Cancelled.")
            liveStatus.text = "Ready when you are."
            refreshUiState()
        }, LinearLayout.LayoutParams(0, dp(42), 1f))

        box.addView(row)
        return box
    }

    private fun buildComposer(): LinearLayout {
        val wrap = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            background = strokeRounded(Color.WHITE, border, 23)
            setPadding(dp(7), dp(7), dp(7), dp(7))
            elevation = dp(6).toFloat()
        }

        input = EditText(this).apply {
            hint = "Tell your phone…"
            setHintTextColor(muted)
            setTextColor(textColor)
            textSize = 14f
            minHeight = dp(50)
            maxLines = 4
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(13), dp(10), dp(11), dp(10))
            background = rounded(pinkSofter, 18)
            setOnFocusChangeListener { _, focused ->
                if (focused) {
                    animateComposer(true)
                }
            }
        }

        wrap.addView(input, LinearLayout.LayoutParams(0, -2, 1f))

        val mic = pillButton("Mic") {
            startVoiceInput()
        }
        wrap.addView(mic, LinearLayout.LayoutParams(dp(53), dp(50)).also {
            it.setMargins(dp(7), 0, 0, 0)
        })

        val send = primaryButton("Send") {
            submitCurrent()
        }
        wrap.addView(send, LinearLayout.LayoutParams(dp(67), dp(50)).also {
            it.setMargins(dp(7), 0, 0, 0)
        })

        return wrap
    }

    private fun saveAndTestKey() {
        val key = keyInput.text.toString().trim()
        if (key.isBlank()) {
            liveStatus.text = "Paste your Groq API key first."
            return
        }

        if (!SecureStore(this).put(key)) {
            liveStatus.text = "Could not save the key securely. Please paste it again."
            return
        }

        statusText.text = "Testing"
        statusDot.background = rounded(pink)
        liveStatus.text = "Checking the Groq connection…"
        stopPulse()
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
        val visible =
            keyInput.inputType == (
                InputType.TYPE_CLASS_TEXT or
                    InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            )

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
            refreshUiState()
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
            } else {
                val error = json.optString("error")
                if (error.isNotBlank()) {
                    addAgent("Error: " + error)
                } else {
                    addAgent(json.optString("message", "Done."))
                }
            }
        } catch (_: Exception) {
            addAgent(raw.ifBlank { "Done." })
        }

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
            val newBubble = TextView(this).apply {
                text = message
                textSize = 12.5f
                setTextColor(pinkDark)
                setPadding(dp(13), dp(11), dp(13), dp(11))
                background = strokeRounded(pinkSofter, border, 18)
                layoutParams = LinearLayout.LayoutParams(
                    (resources.displayMetrics.widthPixels * 0.84f).toInt(),
                    -2
                ).also {
                    it.gravity = Gravity.START
                    it.setMargins(0, dp(5), 0, dp(5))
                }
            }
            progressBubble = newBubble
            chat.addView(newBubble)
            animateIn(newBubble)
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

        chatScroll.post { chatScroll.fullScroll(View.FOCUS_DOWN) }
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
                statusText.text = "Ready"
                statusDetail.text = "Groq is configured and Accessibility is active."
                if (liveStatus.text.isNullOrBlank() || liveStatus.text.toString() == "Understanding your request…") {
                    liveStatus.text = "Ready when you are."
                }
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

    private lateinit var statusDetailDummy: TextView

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

        chatScroll.post { chatScroll.fullScroll(View.FOCUS_DOWN) }
    }

    private fun togglePanel(panel: View) {
        if (panel.visibility == View.VISIBLE) {
            animateOut(panel)
            panel.postDelayed({ panel.visibility = View.GONE }, 170)
        } else {
            panel.visibility = View.VISIBLE
            animateIn(panel)
        }
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

    private fun animateComposer(keyboard: Boolean) {
        val target = if (keyboard) -dp(3).toFloat() else 0f
        composer.animate()
            .translationY(target)
            .setDuration(180)
            .setInterpolator(DecelerateInterpolator())
            .start()
    }

    private fun installInsetsAnimation() {
        root.setOnApplyWindowInsetsListener { _, insets ->
            applyInsets(insets)
            insets
        }

        root.requestApplyInsets()

        if (Build.VERSION.SDK_INT >= 30) {
            root.setWindowInsetsAnimationCallback(
                object : WindowInsetsAnimation.Callback(
                    WindowInsetsAnimation.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
                ) {
                    override fun onProgress(
                        insets: WindowInsets,
                        runningAnimations: MutableList<WindowInsetsAnimation>
                    ): WindowInsets {
                        applyInsets(insets)
                        return insets
                    }

                    override fun onEnd(animation: WindowInsetsAnimation) {
                        super.onEnd(animation)
                        val insets = root.rootWindowInsets ?: return
                        val ime = insets.getInsets(WindowInsets.Type.ime())
                        val bars = insets.getInsets(WindowInsets.Type.systemBars())
                        animateComposer(ime.bottom > bars.bottom)
                    }
                }
            )
        }
    }

    private fun applyInsets(insets: WindowInsets) {
        val bars = if (Build.VERSION.SDK_INT >= 30) {
            insets.getInsets(WindowInsets.Type.systemBars())
        } else {
            @Suppress("DEPRECATION")
            insets.systemWindowInsetBottom.let {
                android.graphics.Insets.of(
                    insets.systemWindowInsetLeft,
                    insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight,
                    it
                )
            }
        }

        val imeBottom = if (Build.VERSION.SDK_INT >= 30) {
            insets.getInsets(WindowInsets.Type.ime()).bottom
        } else {
            0
        }

        root.setPadding(
            dp(16) + bars.left,
            dp(12) + bars.top,
            dp(16) + bars.right,
            dp(10) + maxOf(bars.bottom, imeBottom)
        )

        animateComposer(imeBottom > bars.bottom)
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
        statusDot.alpha = 1f
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
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                )
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Tell your phone what to do")
            }
            startActivityForResult(intent, voiceRequestCode)
        } catch (_: Exception) {
            addAgent("Voice input is not available on this device.")
        }
    }

    override fun onActivityResult(
        requestCode: Int,
        resultCode: Int,
        data: Intent?
    ) {
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
