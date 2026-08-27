package com.analytics.agent.ui.navigation

import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.analytics.agent.data.repository.AnalyticsRepository
import com.analytics.agent.ui.VmFactory
import com.analytics.agent.ui.screens.auth.LoginScreen
import com.analytics.agent.ui.screens.auth.LoginViewModel
import com.analytics.agent.ui.screens.dashboard.DashboardScreen
import com.analytics.agent.ui.screens.dashboard.DashboardViewModel
import com.analytics.agent.ui.screens.dataset.DatasetScreen
import com.analytics.agent.ui.screens.dataset.DatasetViewModel
import com.analytics.agent.ui.screens.dax.DaxScreen
import com.analytics.agent.ui.screens.dax.DaxViewModel
import com.analytics.agent.ui.screens.newproject.NewProjectScreen
import com.analytics.agent.ui.screens.newproject.NewProjectViewModel
import com.analytics.agent.ui.screens.progress.AnalysisProgressScreen
import com.analytics.agent.ui.screens.progress.ProgressViewModel
import com.analytics.agent.ui.screens.projects.ProjectsScreen
import com.analytics.agent.ui.screens.projects.ProjectsViewModel
import com.analytics.agent.ui.screens.prompt.PromptViewModel
import com.analytics.agent.ui.screens.prompt.ReportPromptScreen
import com.analytics.agent.ui.screens.quality.DataQualityScreen
import com.analytics.agent.ui.screens.quality.DataQualityViewModel
import com.analytics.agent.ui.screens.results.AnalysisResultsScreen
import com.analytics.agent.ui.screens.results.ResultsViewModel
import com.analytics.agent.ui.screens.settings.ProjectSettingsScreen
import com.analytics.agent.ui.screens.settings.ProjectSettingsViewModel

@Composable
fun AnalyticsNavHost(
    repository: AnalyticsRepository,
    windowSizeClass: WindowSizeClass,
    navController: NavHostController = rememberNavController(),
) {
    val isExpanded = windowSizeClass.widthSizeClass != WindowWidthSizeClass.Compact

    NavHost(navController = navController, startDestination = Route.Login.path) {

        composable(Route.Login.path) {
            val vm: LoginViewModel = viewModel(factory = VmFactory(repository) { LoginViewModel(it) })
            val state by vm.state.collectAsState()

            LaunchedEffect(state.profile) {
                if (state.profile != null) {
                    vm.consumeProfile()
                    navController.navigate(Route.Projects.path) {
                        popUpTo(Route.Login.path) { inclusive = true }
                    }
                }
            }

            LoginScreen(
                state = state,
                onEmailChange = vm::onEmailChange,
                onPasswordChange = vm::onPasswordChange,
                onSubmit = vm::signIn,
            )
        }

        composable(Route.Projects.path) {
            val vm: ProjectsViewModel = viewModel(factory = VmFactory(repository) { ProjectsViewModel(it) })
            val state by vm.state.collectAsState()

            ProjectsScreen(
                state = state,
                isExpanded = isExpanded,
                onQueryChange = vm::onQueryChange,
                onRefresh = vm::refresh,
                onOpenProject = { navController.navigate(Route.Dataset.of(it.id)) },
                onNewProject = { navController.navigate(Route.NewProject.path) },
                onSignOut = {
                    vm.signOut {
                        navController.navigate(Route.Login.path) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                },
            )
        }

        composable(Route.NewProject.path) {
            val vm: NewProjectViewModel = viewModel(factory = VmFactory(repository) { NewProjectViewModel(it) })
            val state by vm.state.collectAsState()

            LaunchedEffect(state.createdProjectId) {
                state.createdProjectId?.let { id ->
                    vm.consumeCreated()
                    navController.navigate(Route.Dataset.of(id)) {
                        popUpTo(Route.NewProject.path) { inclusive = true }
                    }
                }
            }

            NewProjectScreen(
                state = state,
                onNameChange = vm::onNameChange,
                onDescriptionChange = vm::onDescriptionChange,
                onSourceTypeChange = vm::onSourceTypeChange,
                onCreate = vm::create,
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Route.Dataset.path,
            arguments = listOf(navArgument(Route.ARG_PROJECT_ID) { type = NavType.StringType }),
        ) { entry ->
            val projectId = entry.arguments?.getString(Route.ARG_PROJECT_ID).orEmpty()
            val vm: DatasetViewModel =
                viewModel(factory = VmFactory(repository) { DatasetViewModel(it, projectId) })
            val state by vm.state.collectAsState()
            val context = androidx.compose.ui.platform.LocalContext.current

            DatasetScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onUpload = { uri -> vm.upload(context, uri) },
                onSelectDataset = vm::selectDataset,
                onCancelUpload = vm::cancelUpload,
                onDismissError = vm::dismissUploadError,
                onRetry = vm::load,
                onOpenQuality = { dataset ->
                    navController.navigate(Route.DataQuality.of(projectId, dataset.id))
                },
                onContinue = { navController.navigate(Route.ReportPrompt.of(projectId)) },
                onOpenSettings = { navController.navigate(Route.ProjectSettings.of(projectId)) },
                onOpenLatestRun = { runId ->
                    navController.navigate(Route.Results.of(projectId, runId))
                },
            )
        }

        composable(
            route = Route.DataQuality.path,
            arguments = listOf(
                navArgument(Route.ARG_PROJECT_ID) { type = NavType.StringType },
                navArgument(Route.ARG_DATASET_ID) { type = NavType.StringType },
            ),
        ) { entry ->
            val datasetId = entry.arguments?.getString(Route.ARG_DATASET_ID).orEmpty()
            val vm: DataQualityViewModel =
                viewModel(factory = VmFactory(repository) { DataQualityViewModel(it, datasetId) })
            val state by vm.state.collectAsState()

            DataQualityScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onRetry = vm::load,
            )
        }

        composable(
            route = Route.ReportPrompt.path,
            arguments = listOf(navArgument(Route.ARG_PROJECT_ID) { type = NavType.StringType }),
        ) { entry ->
            val projectId = entry.arguments?.getString(Route.ARG_PROJECT_ID).orEmpty()
            val vm: PromptViewModel =
                viewModel(factory = VmFactory(repository) { PromptViewModel(it, projectId) })
            val state by vm.state.collectAsState()

            LaunchedEffect(state.startedRunId) {
                state.startedRunId?.let { runId ->
                    vm.consumeStarted()
                    navController.navigate(Route.Progress.of(projectId, runId))
                }
            }

            ReportPromptScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onPromptChange = vm::onPromptChange,
                onSuggestion = vm::applySuggestion,
                onStart = vm::start,
                onOpenActiveRun = { runId -> navController.navigate(Route.Progress.of(projectId, runId)) },
            )
        }

        composable(
            route = Route.Progress.path,
            arguments = listOf(
                navArgument(Route.ARG_PROJECT_ID) { type = NavType.StringType },
                navArgument(Route.ARG_RUN_ID) { type = NavType.StringType },
            ),
        ) { entry ->
            val projectId = entry.arguments?.getString(Route.ARG_PROJECT_ID).orEmpty()
            val runId = entry.arguments?.getString(Route.ARG_RUN_ID).orEmpty()
            val vm: ProgressViewModel =
                viewModel(factory = VmFactory(repository) { ProgressViewModel(it, runId) })
            val state by vm.state.collectAsState()

            AnalysisProgressScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onCancel = vm::cancel,
                onViewResults = {
                    navController.navigate(Route.Results.of(projectId, runId)) {
                        popUpTo(Route.Progress.path) { inclusive = true }
                    }
                },
                onRetryWatch = vm::watch,
            )
        }

        composable(
            route = Route.Results.path,
            arguments = listOf(
                navArgument(Route.ARG_PROJECT_ID) { type = NavType.StringType },
                navArgument(Route.ARG_RUN_ID) { type = NavType.StringType },
            ),
        ) { entry ->
            val runId = entry.arguments?.getString(Route.ARG_RUN_ID).orEmpty()
            val vm: ResultsViewModel =
                viewModel(factory = VmFactory(repository) { ResultsViewModel(it, runId) })
            val state by vm.state.collectAsState()

            AnalysisResultsScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onSelectTab = vm::selectTab,
                onReload = vm::loadAll,
                onMetricQueryChange = vm::onMetricQueryChange,
                onOpenDax = { navController.navigate(Route.Dax.of(runId)) },
                onOpenDashboard = { navController.navigate(Route.Dashboard.of(runId)) },
            )
        }

        composable(
            route = Route.Dax.path,
            arguments = listOf(navArgument(Route.ARG_RUN_ID) { type = NavType.StringType }),
        ) { entry ->
            val runId = entry.arguments?.getString(Route.ARG_RUN_ID).orEmpty()
            val vm: DaxViewModel = viewModel(factory = VmFactory(repository) { DaxViewModel(it, runId) })
            val state by vm.state.collectAsState()

            DaxScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onQueryChange = vm::onQueryChange,
                onSelectGroup = vm::selectGroup,
                onToggleExpanded = vm::toggleExpanded,
                onReload = vm::load,
                onExport = vm::exportText,
                onMessage = vm::showMessage,
            )
        }

        composable(
            route = Route.Dashboard.path,
            arguments = listOf(navArgument(Route.ARG_RUN_ID) { type = NavType.StringType }),
        ) { entry ->
            val runId = entry.arguments?.getString(Route.ARG_RUN_ID).orEmpty()
            val vm: DashboardViewModel =
                viewModel(factory = VmFactory(repository) { DashboardViewModel(it, runId) })
            val state by vm.state.collectAsState()
            val context = androidx.compose.ui.platform.LocalContext.current

            DashboardScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onSave = { vm.saveToGallery(context) },
                onReload = vm::load,
                onConsumeMessage = vm::consumeMessage,
            )
        }

        composable(
            route = Route.ProjectSettings.path,
            arguments = listOf(navArgument(Route.ARG_PROJECT_ID) { type = NavType.StringType }),
        ) { entry ->
            val projectId = entry.arguments?.getString(Route.ARG_PROJECT_ID).orEmpty()
            val vm: ProjectSettingsViewModel =
                viewModel(factory = VmFactory(repository) { ProjectSettingsViewModel(it, projectId) })
            val state by vm.state.collectAsState()

            LaunchedEffect(state.deleted) {
                if (state.deleted) {
                    navController.navigate(Route.Projects.path) {
                        popUpTo(Route.Projects.path) { inclusive = true }
                    }
                }
            }

            ProjectSettingsScreen(
                state = state,
                onBack = { navController.popBackStack() },
                onNameChange = vm::onNameChange,
                onDescriptionChange = vm::onDescriptionChange,
                onSave = vm::save,
                onShowDeleteDialog = vm::showDeleteDialog,
                onDeleteConfirmChange = vm::onDeleteConfirmChange,
                onDelete = vm::delete,
                onOpenRun = { runId -> navController.navigate(Route.Results.of(projectId, runId)) },
                onConsumeMessage = vm::consumeMessage,
            )
        }
    }
}
