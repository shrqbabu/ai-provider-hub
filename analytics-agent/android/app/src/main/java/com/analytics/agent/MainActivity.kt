package com.analytics.agent

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.ui.Modifier
import com.analytics.agent.ui.navigation.AnalyticsNavHost
import com.analytics.agent.ui.theme.AnalyticsTheme

class MainActivity : ComponentActivity() {

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val repository = (application as AnalyticsApp).repository

        setContent {
            AnalyticsTheme {
                val windowSizeClass = calculateWindowSizeClass(this)
                Surface(
                    modifier = Modifier,
                    color = MaterialTheme.colorScheme.background,
                ) {
                    AnalyticsNavHost(
                        repository = repository,
                        windowSizeClass = windowSizeClass,
                    )
                }
            }
        }
    }
}
