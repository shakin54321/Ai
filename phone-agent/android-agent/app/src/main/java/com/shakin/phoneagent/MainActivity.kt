package com.shakin.phoneagent

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.text.InputType
import android.text.method.PasswordTransformationMethod
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity() {

    private lateinit var statusText: TextView
    private lateinit var statusDetail: TextView
    private lateinit var statusDot: View
    private lateinit var chat: LinearLayout
    private lateinit var input: EditText
    private lateinit var keyInput: EditText
    private lateinit var keyButton: Button
    private lateinit var settingsPanel: LinearLayout
    private lateinit var confirmPanel: LinearLayout

    private val bg = Color.rgb(255, 247, 251)
    private val card = Color.WHITE
    private val pink = Color.rgb(255, 91, 145)
    private val pinkDark = Color.rgb(224, 54, 111)
    private val pinkSoft = Color.rgb(255, 229, 239)
    private val pinkSofter = Color.rgb(255, 241, 246)
    private val textColor = Color.rgb(52, 35, 43)
    private val muted = Color.rgb(128, 102, 112)
    private val border = Color.rgb(244, 218, 229)
    private val voiceRequestCode = 991

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        buildUi()
        refreshUiState()
    }

    override fun onResume() {
        super.onResume()
        refreshUiState()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(12))
            setBackgroundColor(bg)
        }

        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        val logo = TextView(this).apply {
            text = "S"
            textSize = 22f
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            background = rounded(pink, 22)
        }
        header.addView(logo, LinearLayout.LayoutParams(dp(48), dp(48)))

        val titles = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
        }
        titles.addView(TextView(this).apply {
            text = "Shakin Agent"
            textSize = 20f
            setTextColor(textColor)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })
        titles.addView(TextView(this).apply {
            text = "Your phone, controlled by your words"
            textSize = 11f
            setTextColor(muted)
        })
        header.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))

        val statusPill = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(10), dp(8), dp(10), dp(8))
            background = strokeRounded(Color.WHITE, border, 999)
        }
        statusDot = View(this)
        statusPill.addView(statusDot, LinearLayout.LayoutParams(dp(8), dp(8)))
        statusText = TextView(this).apply {
            textSize = 10f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setTextColor(pinkDark)
            setPadding(dp(6), 0, 0, 0)
        }
        statusPill.addView(statusText)
        header.addView(statusPill)

        root.addView(header)
        root.addView(space(12))

        val statusCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            background = strokeRounded(card, border, 24)
        }

        statusDetail = TextView(this).apply {
            textSize = 11f
            setTextColor(muted)
            maxLines = 2
        }
        statusCard.addView(statusDetail)

        val actionRow = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }
        actionRow.addView(pillButton("Enable Accessibility") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        actionRow.addView(spaceH(8))
        actionRow.addView(pillButton("Settings") {
            settingsPanel.visibility =
                if (settingsPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        statusCard.addView(space(10))
        statusCard.addView(actionRow)

        root.addView(statusCard)
        root.addView(space(12))

        val chatScroll = ScrollView(this).apply {
            isFillViewport = true
            background = strokeRounded(card, border, 24)
        }

        chat = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(14), dp(12), dp(14))
        }

        chat.addView(TextView(this).apply {
            text = "Try “Open YouTube”, “Open WhatsApp”, “Go home”, or describe a multi-step task."
            textSize = 12f
            setTextColor(muted)
            setPadding(dp(4), dp(4), dp(4), dp(8))
        })

        chatScroll.addView(chat)
        root.addView(chatScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(space(10))

        settingsPanel = buildSettingsPanel()
        settingsPanel.visibility = View.GONE
        root.addView(settingsPanel)
        root.addView(space(8))

        confirmPanel = buildConfirmPanel()
        confirmPanel.visibility = View.GONE
        root.addView(confirmPanel)
        root.addView(space(8))

        val composer = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        input = EditText(this).apply {
            hint = "Tell your phone…"
            setHintTextColor(muted)
            setTextColor(textColor)
            textSize = 14f
            minHeight = dp(54)
            maxLines = 4
            setPadding(dp(15), dp(12), dp(15), dp(12))
            background = strokeRounded(card, border, 20)
        }

        composer.addView(input, LinearLayout.LayoutParams(0, -2, 1f))

        composer.addView(pillButton("Mic") {
            startVoiceInput()
        }, LinearLayout.LayoutParams(dp(58), dp(54)).also {
            it.setMargins(dp(8), 0, 0, 0)
        })

        composer.addView(primaryButton("Send") {
            submitCurrent()
        }, LinearLayout.LayoutParams(dp(72), dp(54)).also {
            it.setMargins(dp(8), 0, 0, 0)
        })

        root.addView(composer)

        setContentView(root)
    }

    private fun buildSettingsPanel(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(15), dp(15), dp(15))
            background = strokeRounded(card, border, 24)
        }

        box.addView(TextView(this).apply {
            text = "Groq Connection"
            textSize = 15f
            setTextColor(textColor)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })

        box.addView(TextView(this).apply {
            text = "Your key stays encrypted on this device."
            textSize = 11f
            setTextColor(muted)
            setPadding(0, dp(4), 0, dp(10))
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
            singleLine = true
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
        }, LinearLayout.LayoutParams(0, dp(44), 1f))

        buttons.addView(spaceH(8))

        buttons.addView(pillButton("Clear") {
            SecureStore(this@MainActivity).put("")
            keyInput.setText("")
            statusDetail.text = "Groq key cleared."
            refreshUiState()
        }, LinearLayout.LayoutParams(0, dp(44), 1f))

        box.addView(space(9))
        box.addView(buttons)
        return box
    }

    private fun buildConfirmPanel(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(13), dp(15), dp(13))
            background = strokeRounded(Color.rgb(255, 247, 226), Color.rgb(246, 220, 165), 22)
        }

        box.addView(TextView(this).apply {
            text = "Confirmation required"
            textSize = 14f
            setTextColor(Color.rgb(139, 93, 26))
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        })

        box.addView(TextView(this).apply {
            text = "This action can affect messages, calls, purchases, deletion, or account/security settings."
            textSize = 11f
            setTextColor(Color.rgb(122, 97, 61))
            setPadding(0, dp(4), 0, dp(8))
        })

        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
        }

        row.addView(primaryButton("Confirm") {
            confirmPanel.visibility = View.GONE
            PhoneAgentAccessibilityService.instance?.confirmPending { response ->
                runOnUiThread { handleAgentResponse(response) }
            }
        }, LinearLayout.LayoutParams(0, dp(44), 1f))

        row.addView(spaceH(8))

        row.addView(pillButton("Cancel") {
            PhoneAgentAccessibilityService.instance?.cancelPending()
            confirmPanel.visibility = View.GONE
            addAgent("Cancelled.")
            refreshUiState()
        }, LinearLayout.LayoutParams(0, dp(44), 1f))

        box.addView(row)
        return box
    }

    private fun saveAndTestKey() {
        val key = keyInput.text.toString().trim()
        if (key.isBlank()) {
            statusDetail.text = "Paste your Groq API key first."
            return
        }

        val saved = SecureStore(this).put(key)
        if (!saved) {
            statusDetail.text = "Could not save the key securely. Please paste it again."
            return
        }

        statusText.text = "Testing"
        statusDot.background = rounded(pink)
        statusDetail.text = "Checking the Groq connection…"

        Thread {
            val result = Planner.testApiKey(key)
            runOnUiThread {
                if (result == "Connected to Groq.") {
                    statusDetail.text = "Groq connected. Natural-language control is ready."
                    statusText.text = "Ready"
                    statusDot.background = rounded(Color.rgb(83, 189, 125))
                    addAgent("Groq connected and your key was saved.")
                } else {
                    statusDetail.text = result
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
        val visible = keyInput.inputType == (
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
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

        service.submit(command) { response ->
            runOnUiThread { handleAgentResponse(response) }
        }

        refreshUiState()
    }

    private fun handleAgentResponse(raw: String) {
        try {
            val json = JSONObject(raw)

            if (json.optBoolean("requiresConfirmation", false)) {
                confirmPanel.visibility = View.VISIBLE
                addAgent(
                    json.optString(
                        "message",
                        "Please confirm this action."
                    )
                )
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

    private fun addUser(message: String) = addBubble(message, true)
    private fun addAgent(message: String) = addBubble(message, false)

    private fun addBubble(message: String, user: Boolean) {
        val bubble = TextView(this).apply {
            text = message
            textSize = 13f
            setTextColor(if (user) Color.WHITE else textColor)
            setPadding(dp(13), dp(11), dp(13), dp(11))
            background = if (user) rounded(pink) else strokeRounded(pinkSofter, border, 18)

            layoutParams = LinearLayout.LayoutParams(
                (resources.displayMetrics.widthPixels * 0.84f).toInt(),
                -2
            ).also {
                it.gravity = if (user) Gravity.END else Gravity.START
                it.setMargins(0, dp(5), 0, dp(5))
            }
        }

        chat.addView(bubble)

        (chat.parent as? ScrollView)?.post {
            (chat.parent as? ScrollView)?.fullScroll(View.FOCUS_DOWN)
        }
    }

    private fun refreshUiState() {
        val service = PhoneAgentAccessibilityService.instance
        val hasKey = SecureStore(this).get().isNotBlank()

        when {
            service?.isWorking() == true -> {
                statusText.text = "Working"
                statusDetail.text = "Your agent is controlling the phone."
                statusDot.background = rounded(Color.rgb(255, 173, 94))
            }

            service?.hasPendingConfirmation() == true -> {
                statusText.text = "Waiting"
                statusDetail.text = "Confirm the pending action below."
                statusDot.background = rounded(Color.rgb(255, 173, 94))
            }

            service != null && hasKey -> {
                statusText.text = "Ready"
                statusDetail.text = "Groq is configured and Accessibility is active."
                statusDot.background = rounded(Color.rgb(83, 189, 125))
            }

            service != null -> {
                statusText.text = "Basic"
                statusDetail.text = "Simple phone commands work. Save a Groq key for natural language."
                statusDot.background = rounded(pink)
            }

            hasKey -> {
                statusText.text = "Key saved"
                statusDetail.text = "Groq key is saved. Enable Accessibility to control the phone."
                statusDot.background = rounded(Color.rgb(102, 164, 221))
            }

            else -> {
                statusText.text = "Setup"
                statusDetail.text = "Save a Groq key and enable Accessibility to get full control."
                statusDot.background = rounded(Color.rgb(204, 141, 164))
            }
        }
    }

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
        }
    }

    private fun primaryButton(
        label: String,
        onClick: () -> Unit
    ): Button = Button(this).apply {
        text = label
        textSize = 11f
        isAllCaps = false
        setTextColor(Color.WHITE)
        background = rounded(pink)
        setOnClickListener { onClick() }
    }

    private fun pillButton(
        label: String,
        onClick: () -> Unit
    ): Button = Button(this).apply {
        text = label
        textSize = 10.5f
        isAllCaps = false
        setTextColor(pinkDark)
        background = strokeRounded(card, border, 17)
        setOnClickListener { onClick() }
    }

    private fun rounded(color: Int, radiusDp: Int = 18): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(radiusDp).toFloat()
        }

    private fun strokeRounded(
        fill: Int,
        stroke: Int,
        radiusDp: Int
    ): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
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
}
