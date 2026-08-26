package com.aihub.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.aihub.android.ui.HubDestination
import com.aihub.android.ui.HubViewModel
import com.aihub.android.ui.theme.HubTheme

class MainActivity : ComponentActivity() {
    private val vm: HubViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            HubTheme(theme = vm.theme) {
                HubDestination(vm)
            }
        }
    }
}
