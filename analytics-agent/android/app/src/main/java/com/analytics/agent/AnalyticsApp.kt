package com.analytics.agent

import android.app.Application
import com.analytics.agent.data.SessionStore
import com.analytics.agent.data.remote.AnalyticsApi
import com.analytics.agent.data.remote.SupabaseAuth
import com.analytics.agent.data.repository.AnalyticsRepository

/**
 * Manual dependency graph. Small enough that a DI framework would add more
 * indirection than value, and it keeps the secret-free wiring obvious:
 * only BuildConfig's three PUBLIC values are read here.
 */
class AnalyticsApp : Application() {

    lateinit var repository: AnalyticsRepository
        private set

    override fun onCreate() {
        super.onCreate()

        val sessionStore = SessionStore(this)
        val auth = SupabaseAuth(
            supabaseUrl = BuildConfig.SUPABASE_URL,
            publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
        )

        lateinit var repo: AnalyticsRepository
        val api = AnalyticsApi(
            baseUrl = BuildConfig.ANALYTICS_API_URL,
            tokenProvider = { repo.accessToken() },
        )
        repo = AnalyticsRepository(auth, api, sessionStore)
        repository = repo
    }
}
