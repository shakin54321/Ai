package com.shakin.phoneagent

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object Planner {
    data class Action(val type:String,val arg:String="",val arg2:String="",val ms:Long=0)
    data class Plan(val message:String,val actions:List<Action>,val risky:Boolean=false)

    fun plan(command:String, ui:String, apps:String, apiKey:String?): Plan {
        if (apiKey.isNullOrBlank()) return fallback(command)
        return try {
            val prompt = """
You are an Android phone-control planner. Return ONLY valid JSON with keys message, risky, actions.
Allowed actions: open_app(arg=app label), tap_text(arg=visible text), type_text(arg=text), back, home, swipe_up, swipe_down, wait(ms), open_url(arg=url).
Risky must be true for deleting data, sending messages, making calls, purchases, changing security settings, or anything irreversible.
Command: $command
Visible UI text now: $ui
Installed app labels: $apps
Prefer the smallest sequence. Do not invent app package names. If the task cannot be safely represented, return no actions and explain in message.
""".trimIndent()
            val body = JSONObject()
                .put("model","openai/gpt-oss-20b")
                .put("temperature",0.1)
                .put("max_completion_tokens",900)
                .put("messages",JSONArray()
                    .put(JSONObject().put("role","system").put("content","Output JSON only."))
                    .put(JSONObject().put("role","user").put("content",prompt)))
            val c = URL("https://api.groq.com/openai/v1/chat/completions").openConnection() as HttpURLConnection
            c.requestMethod="POST"
            c.doOutput=true
            c.connectTimeout=12000
            c.readTimeout=20000
            c.setRequestProperty("Authorization","Bearer $apiKey")
            c.setRequestProperty("Content-Type","application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
            val text=(if(c.responseCode in 200..299) c.inputStream else c.errorStream).bufferedReader().readText()
            c.disconnect()
            if(text.isBlank()) return fallback(command)
            val root=JSONObject(text)
            val content=root.getJSONArray("choices").getJSONObject(0).getJSONObject("message").optString("content")
            val json=JSONObject(content.substringAfter("{").substringBeforeLast("}").let{"{$it}"})
            val arr=json.optJSONArray("actions") ?: JSONArray()
            val actions=mutableListOf<Action>()
            for(i in 0 until arr.length()){
                val a=arr.getJSONObject(i)
                actions += Action(a.optString("type"),a.optString("arg"),a.optString("arg2"),a.optLong("ms",0))
            }
            Plan(json.optString("message","Done."),actions,json.optBoolean("risky",false))
        } catch(e:Exception) { fallback(command) }
    }

    private fun fallback(command:String): Plan {
        val c=command.trim(); val l=c.lowercase()
        return when {
            l=="go home" || l=="home" || l=="open home" -> Plan("Going home.",listOf(Action("home")))
            l=="go back" || l=="back" -> Plan("Going back.",listOf(Action("back")))
            l.startsWith("open ") || l.startsWith("launch ") -> Plan("Opening " + c.substringAfter(' ') + ".",listOf(Action("open_app",c.substringAfter(' '))))
            l.startsWith("type ") || l.startsWith("write ") -> Plan("Typing the text.",listOf(Action("type_text",c.substringAfter(' '))))
            l.startsWith("tap ") || l.startsWith("press ") -> Plan("Tapping the requested control.",listOf(Action("tap_text",c.substringAfter(' '))))
            l.contains("scroll up") -> Plan("Scrolling up.",listOf(Action("swipe_up")))
            l.contains("scroll down") -> Plan("Scrolling down.",listOf(Action("swipe_down")))
            else -> Plan("I need a Groq API key for natural-language planning. Basic commands like Open, Home, Back, Type and Tap still work.",emptyList())
        }
    }
}
