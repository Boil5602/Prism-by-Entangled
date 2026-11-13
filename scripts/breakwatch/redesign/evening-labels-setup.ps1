# The two lasting changes the labelled evenings need on the dev PC (2026-11-09). A person runs this; it is never run for them.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\breakwatch\redesign\evening-labels-setup.ps1            set up
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\breakwatch\redesign\evening-labels-setup.ps1 -Remove    take both away
#
# 1. The scheduled task "Prism break-watch evening labels": each night at 23:05 from 2026-11-10, the last on 2026-11-16, with no window
#    (conhost --headless). It runs evening-labels.sh, which holds the spend fences (five evenings, four hours each).
# 2. Two variables of this Windows user, PRISM_DEV_SHOT=1 and PRISM_FRAME_SAMPLER=1, so that a PRISM started at sign-in answers the
#    sampler and records the bench's frames. Without them a sign-in start records nothing (found 2026-11-09: a day of recording lost).
#    They reach a PRISM started after the next sign-in, or after a restart of PRISM from a new shell.
param([switch]$Remove)
$name = 'Prism break-watch evening labels'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  [Environment]::SetEnvironmentVariable('PRISM_DEV_SHOT', $null, 'User')
  [Environment]::SetEnvironmentVariable('PRISM_FRAME_SAMPLER', $null, 'User')
  'removed: the task and the two variables'
  exit 0
}
$arg = '--headless cmd /c cd /d C:\Projects\prism && "C:\Program Files\Git\bin\bash.exe" scripts/breakwatch/redesign/evening-labels.sh >> scripts\doctor\out\redesign-20261107\evenings\task.log 2>&1'
$act = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $arg
$trg = New-ScheduledTaskTrigger -Daily -At '2026-11-10T23:05:00'
$trg.EndBoundary = '2026-11-16T23:59:00'
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -Force -Description 'Labels the evening recording of the screen window (19:00 to 23:00) for the break watch. Five evenings at most, none after 2026-11-16. scripts/breakwatch/redesign/evening-labels.sh' | Out-Null
[Environment]::SetEnvironmentVariable('PRISM_DEV_SHOT', '1', 'User')
[Environment]::SetEnvironmentVariable('PRISM_FRAME_SAMPLER', '1', 'User')
$t = Get-ScheduledTask -TaskName $name
"task: next run $(($t | Get-ScheduledTaskInfo).NextRunTime), ends $($t.Triggers[0].EndBoundary)"
"variables: PRISM_DEV_SHOT=$([Environment]::GetEnvironmentVariable('PRISM_DEV_SHOT', 'User')) PRISM_FRAME_SAMPLER=$([Environment]::GetEnvironmentVariable('PRISM_FRAME_SAMPLER', 'User'))"
