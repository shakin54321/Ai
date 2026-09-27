package com.shakin.phoneagent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper

class AgentRuntimeService : Service() {

    companion object {
        const val ACTION_START = "com.shakin.phoneagent.action.START"
        const val ACTION_STOP = "com.shakin.phoneagent.action.STOP"

        private const val CHANNEL_ID = "shakin_agent_runtime"
        private const val NOTIFICATION_ID = 4101
        private const val PREFS = "agent_runtime"
        private const val KEY_ENABLED = "always_on"

        @Volatile var running = false
            private set

        fun isEnabled(context: android.content.Context): Boolean =
            context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .getBoolean(KEY_ENABLED, false)

        fun setEnabled(context: android.content.Context, enabled: Boolean) {
            context.getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_ENABLED, enabled)
                .apply()
        }

        fun start(context: android.content.Context) {
            setEnabled(context, true)
            val intent = Intent(context, AgentRuntimeService::class.java)
                .setAction(ACTION_START)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: android.content.Context) {
            setEnabled(context, false)
            context.stopService(Intent(context, AgentRuntimeService::class.java))
        }
    }

    private val handler = Handler(Looper.getMainLooper())

    private val watchdog = object : Runnable {
        override fun run() {
            if (!running) return

            val accessibilityOn = PhoneAgentAccessibilityService.instance != null
            updateNotification(
                if (accessibilityOn) {
                    "Always-on runtime active • Accessibility connected"
                } else {
                    "Always-on runtime active • Enable Accessibility"
                }
            )

            handler.postDelayed(this, 15_000L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        promoteToForeground()
        running = true
        handler.post(watchdog)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                setEnabled(this, false)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                setEnabled(this, true)
                promoteToForeground()
            }
        }
        return START_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (isEnabled(this)) {
            runCatching {
                val restart = Intent(this, AgentRuntimeService::class.java)
                    .setAction(ACTION_START)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(restart)
                } else {
                    startService(restart)
                }
            }
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun promoteToForeground() {
        val notification = buildNotification(
            "Always-on runtime active • Keeping the agent ready"
        )

        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                "Shakin Agent runtime",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps Shakin Agent's user-requested runtime alive in the background."
                setShowBadge(false)
            }
        )
    }

    private fun buildNotification(text: String): Notification {
        val openIntent = PendingIntent.getActivity(
            this,
            10,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = PendingIntent.getService(
            this,
            11,
            Intent(this, AgentRuntimeService::class.java)
                .setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("Shakin Agent")
            .setContentText(text)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setContentIntent(openIntent)
            .addAction(
                Notification.Action.Builder(
                    android.graphics.drawable.Icon.createWithResource(
                        this,
                        android.R.drawable.ic_media_pause
                    ),
                    "Stop",
                    stopIntent
                ).build()
            )
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text))
    }
}
