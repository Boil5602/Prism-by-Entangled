# Building the Windows app

The Windows app (`targets/win-host`) is a WinUI 3 program. Its service windows are WebView2, and
its behavior comes from prism-core, bundled into `packages/core/dist/prism-runtime.js` and run in
a hidden WebView2 (the "brain"). Visual Studio isn't needed: everything builds with the .NET SDK
and Node.js from the command line.

## What you need

- **Windows 10 (version 2004, build 19041) or later, or Windows 11, on x64.**
- **The .NET SDK 9.0.317.** `targets/win-host/global.json` pins this version. The app itself
  targets .NET 8 (`net8.0-windows10.0.19041.0`), which the .NET 9 SDK builds.
- **Node.js 20 or later** with npm (for prism-core and its bundle).
- **The Microsoft Edge WebView2 Runtime.** It comes with Windows 11 and current Windows 10;
  otherwise install the Evergreen runtime from Microsoft.
- Git.

## Build and run

From the repository root:

```powershell
npm install                      # prism-core's tools (TypeScript, esbuild, vitest)
cd packages\core
npx esbuild src/runtime.ts --bundle --format=iife --outfile=dist/prism-runtime.js
cd ..\..\targets\win-host\PrismHost
dotnet build -p:Platform=x64
```

Then run the app:

```powershell
.\bin\x64\Debug\net8.0-windows10.0.19041.0\win-x64\PrismHost.exe
```

Notes:

- **Always pass `-p:Platform=x64`.** The app is self-contained, and an AnyCPU build fails.
- **Close Prism before rebuilding.** A running copy holds its files open and the build stops with
  an error about a locked `PrismHost.Core.dll`.
- **The core bundle.** A fresh clone has no `prism-runtime.js`; the build makes it once
  automatically (the `EnsureRuntimeBundle` target). After changing anything in `packages/core/src`,
  run the esbuild line above again, then restart the app.
- **Your data.** The app keeps its settings, service sign-ins and logs in `%LOCALAPPDATA%\Prism`
  (the logs are in its `diagnostics` folder: `host.log`, `eme.log`, `firstchance.log`).
- **A clean first run.** `scripts\run-fresh.ps1` starts the app with a brand-new data folder, so
  your real settings and sign-ins aren't touched. The `PRISM_DATA_DIR` environment variable points
  the app at any data folder.

## Tests

```powershell
dotnet test targets\win-host\PrismHost.Tests\PrismHost.Tests.csproj   # the host's tests
cd packages\core; npx vitest run; npx tsc -p tsconfig.json       # prism-core
node scripts\verify.mjs                                         # everything a change must pass
```

## A package for another computer

A self-contained Release build that runs on a PC without the .NET SDK:

```powershell
cd targets\win-host\PrismHost
dotnet publish -c Release -p:Platform=x64 -r win-x64 --self-contained -o ..\..\..\dist\PrismHost
```

The publish includes the compiled XAML (`App.xbf`, `MainWindow.xbf`) and `PrismHost.pri`; the
build log says "Prism: XAML and PRI copied to the publish (3 files)". Zip the output folder and
run `PrismHost.exe` from it on the other PC. Protected video (Netflix, Disney+ and others) won't
play over Remote Desktop; test it at the computer itself.

## Troubleshooting

- **The window opens and closes at once from a publish:** the compiled XAML or `PrismHost.pri` is
  missing from the folder. Rebuild with the publish command above and check for the "XAML and PRI
  copied" line.
- **Build errors mentioning `Microsoft.Build.Packaging.Pri.Tasks`:** that comes from an older
  Windows App SDK (1.5) that needs Visual Studio. This project uses 2.4, which doesn't; make sure
  the package reference wasn't changed.
- **Nothing shows in the windows:** look in `%LOCALAPPDATA%\Prism\diagnostics\host.log`. Every
  message between the app and the brain is written there.
