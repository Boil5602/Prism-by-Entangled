<#
  Prism kiosk - Windows + Edge policy set. Idempotent; re-run any time.

  Goal: Windows and Edge become invisible plumbing. No consumer promotions,
  no lock-screen ads, no notifications, no Copilot/widgets/rewards, no sync
  or sign-in prompts, no forced reboots during evening hours, and telemetry
  at the Pro minimum. Nothing here touches the dashboard's own behavior -
  that is prism-core's job (spec section 23).
#>
$ErrorActionPreference = "SilentlyContinue"
function P($path, $name, $value, $type = "DWord") {
  if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
  Set-ItemProperty -Path $path -Name $name -Value $value -Type $type
}

# ---------------------------------------------------------------- Windows
$pol = "HKLM:\SOFTWARE\Policies\Microsoft\Windows"
$cdm = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"

# consumer promotions, suggested apps, lock-screen Spotlight ads
P "$pol\CloudContent" DisableWindowsConsumerFeatures 1
P "$pol\CloudContent" DisableSoftLanding 1
P "$pol\CloudContent" DisableCloudOptimizedContent 1
P "$pol\CloudContent" DisableConsumerAccountStateContent 1
foreach ($k in "ContentDeliveryAllowed","SubscribedContent-310093Enabled","SubscribedContent-338387Enabled","SubscribedContent-338388Enabled","SubscribedContent-338389Enabled","SubscribedContent-353694Enabled","SubscribedContent-353696Enabled","SilentInstalledAppsEnabled","SystemPaneSuggestionsEnabled","SoftLandingEnabled","RotatingLockScreenEnabled","RotatingLockScreenOverlayEnabled") { P $cdm $k 0 }

# notifications, toasts, tips
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\PushNotifications" ToastEnabled 0
P "$pol\Explorer" DisableNotificationCenter 1
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings" NOC_GLOBAL_SETTING_ALLOW_TOASTS_ABOVE_LOCK 0

# Copilot, widgets, news & interests, search web results, rewards
P "HKCU:\SOFTWARE\Policies\Microsoft\Windows\WindowsCopilot" TurnOffWindowsCopilot 1
P "$pol\WindowsCopilot" TurnOffWindowsCopilot 1
P "$pol\Dsh" AllowNewsAndInterests 0
P "$pol\Windows Search" DisableWebSearch 1
P "$pol\Windows Search" ConnectedSearchUseWeb 0
P "$pol\Explorer" DisableSearchBoxSuggestions 1

# telemetry at the Pro minimum; no feedback nags; no advertising id
P "$pol\DataCollection" AllowTelemetry 1
P "$pol\DataCollection" DoNotShowFeedbackNotifications 1
P "$pol\AdvertisingInfo" DisabledByGroupPolicy 1
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo" Enabled 0

# Windows Update: install, but never reboot on its own; quality updates only
$wu = "$pol\WindowsUpdate"
P "$wu\AU" NoAutoRebootWithLoggedOnUsers 1
P "$wu\AU" AUOptions 4
P "$wu\AU" ScheduledInstallDay 0
P "$wu\AU" ScheduledInstallTime 4
P $wu SetActiveHours 1
P $wu ActiveHoursStart 6
P $wu ActiveHoursEnd 2    # 06:00 - 02:00: an 18-hour window (the max) - wall is in use
P $wu DeferFeatureUpdates 1
P $wu DeferFeatureUpdatesPeriodInDays 365
P $wu SetDisableUXAccess 1

# OneDrive, Windows Hello / account nags, Game Bar, Xbox
P "$pol\OneDrive" DisableFileSyncNGSC 1
Remove-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name OneDrive
P "$pol\System" DisableAcrylicBackgroundOnLogon 1
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\UserProfileEngagement" ScoobeSystemSettingEnabled 0
P "$pol\GameDVR" AllowGameDVR 0
P "HKCU:\SOFTWARE\Microsoft\GameBar" AutoGameModeEnabled 0

# lock screen + screensaver off (the wall never blanks; power plan handles the rest)
P "$pol\Personalization" NoLockScreen 1
P "HKCU:\Control Panel\Desktop" ScreenSaveActive 0 String

# Explorer/Start never shows: still, keep them quiet if a maintainer opens them
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced" ShowTaskViewButton 0
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced" TaskbarDa 0
P "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced" Start_TrackProgs 0

# ---------------------------------------------------------------- Edge
$e = "HKLM:\SOFTWARE\Policies\Microsoft\Edge"
P $e HideFirstRunExperience 1
P $e BrowserSignin 0
P $e SyncDisabled 1
P $e ImportOnEachLaunch 0
P $e AutoImportAtFirstRun 4
P $e StartupBoostEnabled 0
P $e BackgroundModeEnabled 0
P $e DefaultBrowserSettingEnabled 0
P $e DefaultBrowserSettingsCampaignEnabled 0
P $e ShowRecommendationsEnabled 0
P $e SpotlightExperiencesAndRecommendationsEnabled 0
P $e HubsSidebarEnabled 0
P $e EdgeCollectionsEnabled 0
P $e EdgeShoppingAssistantEnabled 0
P $e ShowMicrosoftRewards 0
P $e EdgeWalletCheckoutEnabled 0
P $e PersonalizationReportingEnabled 0
P $e MetricsReportingEnabled 0
P $e DiagnosticData 0
P $e UserFeedbackAllowed 0
P $e PasswordManagerEnabled 0
P $e AutofillCreditCardEnabled 0
P $e AutofillAddressEnabled 0
P $e DefaultNotificationsSetting 2
P $e PromotionalTabsEnabled 0
P $e WebWidgetAllowed 0
P $e ConfigureDoNotTrack 1
P $e AlternateErrorPagesEnabled 0
P $e SearchSuggestEnabled 0
P $e NewTabPageHideDefaultTopSites 1
P $e NewTabPageContentEnabled 0
P $e NewTabPageQuickLinksEnabled 0
P $e EdgeEntraCopilotPageContext 0
P $e CopilotPageContext 0
P $e ComposeInlineEnabled 0
P $e MicrosoftEditorProofingEnabled 0
P $e ResolveNavigationErrorsUseWebService 0
P $e ShowHomeButton 0
P $e SmartScreenEnabled 1        # keep: protects the frame from malicious downloads
P $e TranslateEnabled 0
P $e VideoCaptureAllowed 1       # camera motion-wake tiles (spec section 24) may use it
P $e AudioCaptureAllowed 1
P $e SleepingTabsEnabled 0       # tiles must never be put to sleep (spec section 16/18)
P $e EfficiencyModeEnabled 0
P $e RendererCodeIntegrityEnabled 1
# Hardware DRM (PlayReady) is what makes this build "the Studio" - leave enabled.
P $e DefaultMediaKeySystemsSetting 1   # allow protected content

Write-Host "Prism policies applied."
