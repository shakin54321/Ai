package com.shakin.phoneagent

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.Gravity
import android.view.View
import android.widget.*
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var statusText: TextView
    private lateinit var statusDot: View
    private lateinit var chat: LinearLayout
    private lateinit var input: EditText
    private lateinit var keyInput: EditText
    private lateinit var settingsPanel: LinearLayout
    private lateinit var confirmPanel: LinearLayout

    private val bg = Color.rgb(11, 13, 20)
    private val textColor = Color.rgb(247, 248, 252)
    private val muted = Color.rgb(165, 170, 188)
    private val accent = Color.rgb(224, 217, 255)
    private val accent2 = Color.rgb(194, 238, 255)
    private val voiceRequestCode = 991

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = bg
        buildUi()
        renderStatus()
    }

    override fun onResume() {
        super.onResume()
        renderStatus()
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(14))
            setBackgroundColor(bg)
        }

        val header = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }

        val icon = TextView(this).apply {
            text = "S"
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(Color.BLACK)
            background = roundGradient(accent, accent2, 18)
            layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
        }

        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(11), 0, 0, 0)
        }

        titleBox.addView(TextView(this).apply {
            text = "Shakin Agent"
            textSize = 18f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setTextColor(textColor)
        })
        titleBox.addView(TextView(this).apply {
            text = "Your phone, controlled by your words"
            textSize = 11f
            setTextColor(muted)
        })

        val status = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(11), dp(7), dp(11), dp(7))
            background = roundStroke(Color.argb(80, 255, 255, 255), 999)
        }
        statusDot = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(8), dp(8))
            background = roundGradient(Color.rgb(255, 205, 130), Color.rgb(255, 230, 175), 999)
        }
        statusText = TextView(this).apply {
            textSize = 10f
            setTextColor(muted)
            setPadding(dp(7), 0, 0, 0)
        }
        status.addView(statusDot)
        status.addView(statusText)
        header.addView(icon)
        header.addView(titleBox, LinearLayout.LayoutParams(0, dp(52), 1f))
        header.addView(status)

        root.addView(header)
        root.addView(space(8))

        val chatScroll = ScrollView(this).apply {
            isFillViewport = true
            background = roundStroke(Color.argb(55, 255, 255, 255), 28)
        }
        chat = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(14), dp(12), dp(14))
        }
        chat.addView(TextView(this).apply {
            text = "Tell me what you want your phone to do.\\n\\nTry:\\n• Open YouTube\\n• Open WhatsApp\\n• Go home\\n• Scroll down\\n• Add a Groq key for natural-language tasks."
            textSize = 13f
            setTextColor(muted)
            setPadding(dp(5), dp(5), dp(5), dp(5))
        })
        chatScroll.addView(chat)
        root.addView(chatScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(space(10))

        settingsPanel = buildSettingsPanel()
        root.addView(settingsPanel)
        settingsPanel.visibility = View.GONE

        confirmPanel = buildConfirmPanel()
        root.addView(confirmPanel)
        confirmPanel.visibility = View.GONE

        val composer = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }

        input = EditText(this).apply {
            hint = "Tell your phone…"
            hintTextColor = muted
            setTextColor(textColor)
            textSize = 14f
            minHeight = dp(54)
            maxLines = 4
            setPadding(dp(15), dp(12), dp(15), dp(12))
            background = roundStroke(Color.argb(70, 255, 255, 255), 20)
        }

        val mic = button("Mic", false) { startVoiceInput() }.apply {
            layoutParams = LinearLayout.LayoutParams(dp(58), dp(54)).also {
                it.setMargins(dp(8), 0, 0, 0)
            }
        }

        val send = button("Send", true) { submitCurrent() }.apply {
            layoutParams = LinearLayout.LayoutParams(dp(72), dp(54)).also {
                it.setMargins(dp(8), 0, 0, 0)
            }
        }

        composer.addView(input, LinearLayout.LayoutParams(0, -2, 1f))
        composer.addView(mic)
        composer.addView(send)
        root.addView(composer)

        val bottom = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        bottom.addView(button("Accessibility", false) {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        bottom.addView(spaceH(8))
        bottom.addView(button("Settings", false) {
            settingsPanel.visibility =
                if (settingsPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }, LinearLayout.LayoutParams(0, dp(42), 1f))

        root.addView(space(8))
        root.addView(bottom)
        setContentView(root)
    }

    private fun buildSettingsPanel(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = roundStroke(Color.argb(65, 255, 255, 255), 22)
        }
        box.addView(TextView(this).apply {
            text = "Agent Settings"
            textSize = 14f
            setTextColor(textColor)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        box.addView(TextView(this).apply {
            text = "Groq is used only for natural-language phone planning."
            textSize = 11f
            setTextColor(muted)
            setPadding(0, dp(5), 0, dp(8))
        })
        keyInput = EditText(this).apply {
            hint = "Groq API key"
            hintTextColor = muted
            setTextColor(textColor)
            inputType = 0x00000081
            setText(SecureStore(this@MainActivity).get())
            background = roundStroke(Color.argb(55, 255, 255, 255), 16)
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        box.addView(keyInput)

        val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        row.addView(button("Save key", true) {
            SecureStore(this@MainActivity).put(keyInput.text.toString().trim())
            addAgent("AI key saved securely on this device.")
            renderStatus()
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        row.addView(spaceH(8))
        row.addView(button("Clear", false) {
            SecureStore(this@MainActivity).put("")
            keyInput.setText("")
            addAgent("AI key cleared.")
            renderStatus()
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        box.addView(space(8))
        box.addView(row)
        return box
    }

    private fun buildConfirmPanel(): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = roundStroke(Color.argb(55, 255, 205, 130), 20)
        }
        box.addView(TextView(this).apply {
            text = "Sensitive action needs confirmation"
            textSize = 13f
            setTextColor(Color.rgb(255, 220, 165))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })

        val actions = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        actions.addView(button("Confirm", true) {
            confirmPanel.visibility = View.GONE
            PhoneAgentAccessibilityService.instance?.confirmPending { message ->
                runOnUiThread { handleAgentResponse(message) }
            }
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        actions.addView(spaceH(8))
        actions.addView(button("Cancel", false) {
            PhoneAgentAccessibilityService.instance?.cancelPending()
            confirmPanel.visibility = View.GONE
            addAgent("Cancelled.")
            renderStatus()
        }, LinearLayout.LayoutParams(0, dp(44), 1f))

        box.addView(space(8))
        box.addView(actions)
        return box
    }

    private fun submitCurrent() {
        val command = input.text.toString().trim()
        if (command.isBlank()) return
        input.setText("")
        addUser(command)

        val service = PhoneAgentAccessibilityService.instance
        if (service == null) {
            addAgent("Accessibility is off. Tap Accessibility below and enable Shakin Agent.")
            return
        }

        service.submit(command) { message ->
            runOnUiThread { handleAgentResponse(message) }
        }
        renderStatus()
    }

    private fun handleAgentResponse(raw: String) {
        try {
            val json = JSONObject(raw)
            if (json.optBoolean("requiresConfirmation", false)) {
                confirmPanel.visibility = View.VISIBLE
                addAgent(json.optString("message", "Please confirm this action."))
                renderStatus()
                return
            }

            val error = json.optString("error")
            if (error.isNotBlank()) addAgent("Error: $error")
            else addAgent(json.optString("message", "Done."))
        } catch (_: Exception) {
            addAgent(raw.ifBlank { "Done." })
        }
        renderStatus()
    }

    private fun addUser(message: String) = addBubble(message, true)
    private fun addAgent(message: String) = addBubble(message, false)

    private fun addBubble(message: String, user: Boolean) {
        val bubble = TextView(this).apply {
            text = message
            textSize = 13f
            setTextColor(textColor)
            setPadding(dp(13), dp(11), dp(13), dp(11))
            background = if (user) {
                roundGradient(Color.argb(95, 224, 217, 255), Color.argb(75, 194, 238, 255), 20)
            } else {
                roundStroke(Color.argb(52, 255, 255, 255), 20)
            }
            layoutParams = LinearLayout.LayoutParams(
                (resources.displayMetrics.widthPixels * 0.82f).toInt(),
                -2
            ).also {
                it.gravity = if (user) Gravity.END else Gravity.START
                it.setMargins(0, dp(5), 0, dp(5))
            }
        }
        chat.addView(bubble)
    }

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
        val value = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull().orEmpty()
        if (value.isNotBlank()) {
            input.setText(value)
            input.setSelection(input.length())
        }
    }

    private fun renderStatus() {
        val service = PhoneAgentAccessibilityService.instance
        val label = when {
            service == null -> "Accessibility off"
            service.isWorking() -> "Working…"
            service.hasPendingConfirmation() -> "Waiting"
            service.hasGroqKey() -> "Ready"
            else -> "Basic mode"
        }
        statusText.text = label
        val dotColor = when {
            service == null -> Color.rgb(255, 130, 130)
            service.isWorking() -> Color.rgb(255, 210, 130)
            else -> Color.rgb(142, 230, 174)
        }
        statusDot.background = roundGradient(dotColor, dotColor, 999)
    }

    private fun button(label: String, primary: Boolean, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 11f
            isAllCaps = false
            setTextColor(if (primary) Color.BLACK else textColor)
            background = if (primary) roundGradient(accent, accent2, 17)
            else roundStroke(Color.argb(60, 255, 255, 255), 17)
            setOnClickListener { onClick() }
        }

    private fun roundStroke(stroke: Int, radiusDp: Int): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable().apply {
            setColor(Color.argb(25, 255, 255, 255))
            setStroke(dp(1), stroke)
            cornerRadius = dp(radiusDp).toFloat()
        }

    private fun roundGradient(a: Int, b: Int, radiusDp: Int): android.graphics.drawable.GradientDrawable =
        android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.TL_BR,
            intArrayOf(a, b)
        ).apply { cornerRadius = dp(radiusDp).toFloat() }

    private fun space(height: Int): View = Space(this).apply {
        layoutParams = LinearLayout.LayoutParams(1, height)
    }

    private fun spaceH(width: Int): View = Space(this).apply {
        layoutParams = LinearLayout.LayoutParams(width, 1)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()
}