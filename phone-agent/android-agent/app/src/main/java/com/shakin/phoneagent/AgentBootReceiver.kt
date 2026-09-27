package com.shakin.phoneagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class AgentBootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (
            intent?.action != Intent.ACTION_BOOT_COMPLETED &&
            intent?.action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            intent?.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        if (!AgentRuntimeService.isEnabled(context)) return

        val serviceIntent = Intent(context, AgentRuntimeService::class.java)
            .setAction(AgentRuntimeService.ACTION_START)

        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        }
    }
}
