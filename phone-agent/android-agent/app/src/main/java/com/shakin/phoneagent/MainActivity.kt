package com.shakin.phoneagent

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.*
import java.util.UUID

class MainActivity : Activity() {
    private lateinit var tokenView: TextView
    private lateinit var groqView: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = getSharedPreferences("agent", MODE_PRIVATE)
        if (prefs.getString("token", null) == null) {
            prefs.edit().putString("token", UUID.randomUUID().toString().replace("-", "").take(24)).apply()
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32,48,32,32)
        }
        val title = TextView(this).apply { textSize=22f; text="Shakin Agent" }
        tokenView = TextView(this).apply { textSize=14f; textIsSelectable=true }
        groqView = EditText(this).apply { hint="Optional Groq API key for natural-language planning"; inputType=129 }
        val openSettings = Button(this).apply {
            text="Enable Accessibility"
            setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }
        val copy = Button(this).apply {
            text="Copy Token"
            setOnClickListener {
                val cm=getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager
                cm.setPrimaryClip(android.content.ClipData.newPlainText("Agent token", prefs.getString("token","")))
                Toast.makeText(this@MainActivity,"Copied",Toast.LENGTH_SHORT).show()
            }
        }
        val save = Button(this).apply {
            text="Save API key"
            setOnClickListener {
                prefs.edit().putString("groq",groqView.text.toString().trim()).apply()
                Toast.makeText(this@MainActivity,"Saved",Toast.LENGTH_SHORT).show()
            }
        }
        root.addView(title)
        root.addView(TextView(this).apply { text="Pairing token"; setPadding(0,24,0,6) })
        root.addView(tokenView)
        root.addView(copy)
        root.addView(groqView)
        root.addView(save)
        root.addView(openSettings)
        root.addView(TextView(this).apply {
            text="Keep the app installed and the Accessibility service enabled. The web console talks only to this phone on localhost."
            setPadding(0,24,0,0)
        })
        setContentView(root)
        tokenView.text=prefs.getString("token","")
        groqView.setText(prefs.getString("groq",""))
    }
}

// CI-ready Android agent build.
