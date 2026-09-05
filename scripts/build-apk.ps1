$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$toolRoot = Join-Path $projectRoot '.toolchains'
$gradleZip = Join-Path $toolRoot 'gradle-9.3.1-bin.zip'
$expectedGradleSha256 = 'b266d5ff6b90eada6dc3b20cb090e3731302e553a27c5d3e4df1f0d76beaff06'
$gradleInstall = Join-Path $toolRoot 'gradle-9.3.1'
$androidRoot = Join-Path $projectRoot 'android'
$sdkRoot = Join-Path $toolRoot 'android-sdk'
$jdkContainer = Join-Path $toolRoot 'jdk17'
$artifactRoot = Join-Path $projectRoot 'artifacts'
$artifact = Join-Path $artifactRoot 'ZhixingOS-1.0.0-preview.apk'
$pipeSmokeSource = Join-Path $PSScriptRoot 'NioPipeSmoke.java'

function Get-Sha256Hex([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha256.ComputeHash($stream)
    return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Enable-JdkPipeCompatibility([string]$JdkHome) {
  $java = Join-Path $JdkHome 'bin\java.exe'
  $javac = Join-Path $JdkHome 'bin\javac.exe'
  $jar = Join-Path $JdkHome 'bin\jar.exe'

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $java $pipeSmokeSource 2>&1 | Out-Null
    $pipeSmokeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($pipeSmokeExitCode -eq 0) { return $null }

  # OpenJDK 17 can prefer AF_UNIX for Pipe/Selector on Windows. Some hosts
  # advertise AF_UNIX but reject its connect call. Gradle then fails before it
  # reads the project. Generate an ignored, host-local java.base patch from the
  # verified JDK's own source and retain the standard TCP loopback path.
  $srcZip = Join-Path $JdkHome 'lib\src.zip'
  if (!(Test-Path -LiteralPath $srcZip)) {
    throw 'The JDK NIO self-test failed and lib\src.zip is unavailable for the Windows loopback compatibility patch.'
  }

  $compatRoot = Join-Path $toolRoot 'jdk17-pipe-compat'
  $sourceRoot = Join-Path $compatRoot 'source'
  $moduleSourceRoot = Join-Path $sourceRoot 'java.base'
  $classesRoot = Join-Path $compatRoot 'classes'
  $pipeSource = Join-Path $moduleSourceRoot 'sun\nio\ch\PipeImpl.java'
  New-Item -ItemType Directory -Force -Path $sourceRoot, $classesRoot | Out-Null

  Push-Location $sourceRoot
  try {
    & $jar xf $srcZip 'java.base/sun/nio/ch/PipeImpl.java'
    if ($LASTEXITCODE -ne 0) { throw 'Failed to extract PipeImpl.java from the verified JDK source archive.' }
  } finally {
    Pop-Location
  }

  $sourceText = [System.IO.File]::ReadAllText($pipeSource)
  $unixPreference = 'if (preferUnixDomain && UnixDomainSockets.isSupported()) {'
  $tcpFallback = 'if (false && preferUnixDomain && UnixDomainSockets.isSupported()) {'
  if (!$sourceText.Contains($unixPreference) -and !$sourceText.Contains($tcpFallback)) {
    throw 'Unsupported JDK PipeImpl source layout; refusing to patch an unknown implementation.'
  }
  if ($sourceText.Contains($unixPreference)) {
    [System.IO.File]::WriteAllText($pipeSource, $sourceText.Replace($unixPreference, $tcpFallback), [System.Text.UTF8Encoding]::new($false))
  }

  try {
    $ErrorActionPreference = 'Continue'
    $compileOutput = & $javac --patch-module "java.base=$moduleSourceRoot" -d $classesRoot $pipeSource 2>&1
    $compileExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($compileExitCode -ne 0) {
    throw "Failed to compile the JDK loopback compatibility patch:`n$($compileOutput -join [Environment]::NewLine)"
  }

  $patchArgument = "--patch-module=java.base=$classesRoot"
  try {
    $ErrorActionPreference = 'Continue'
    & $java $patchArgument $pipeSmokeSource 2>&1 | Out-Null
    $patchedPipeSmokeExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($patchedPipeSmokeExitCode -ne 0) { throw 'JDK NIO self-test still fails after applying the loopback compatibility patch.' }
  return $patchArgument
}

if (!(Test-Path -LiteralPath $gradleZip)) {
  throw "Missing $gradleZip. Download the Gradle 9.3.1 binary-only ZIP without extracting it."
}

$actualSha256 = Get-Sha256Hex $gradleZip
if ($actualSha256 -ne $expectedGradleSha256) {
  throw "Gradle ZIP checksum mismatch. Expected $expectedGradleSha256 but found $actualSha256. The file will not be executed."
}

if (!(Test-Path -LiteralPath (Join-Path $gradleInstall 'bin\gradle.bat'))) {
  $extractRoot = Join-Path $toolRoot 'gradle-extract'
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $gradleZip -DestinationPath $extractRoot -Force
  $extracted = Join-Path $extractRoot 'gradle-9.3.1'
  if (!(Test-Path -LiteralPath $extracted)) { throw 'Invalid Gradle ZIP structure.' }
  Move-Item -LiteralPath $extracted -Destination $gradleInstall
}

$jdkHome = (Get-ChildItem -LiteralPath $jdkContainer -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'bin\java.exe') } | Select-Object -First 1).FullName
if (!$jdkHome) { throw 'Verified JDK 17 was not found.' }
if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'platforms\android-36\android.jar'))) { throw 'Android SDK 36 was not found.' }
if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'ndk\27.1.12297006'))) { throw 'Android NDK 27.1.12297006 was not found.' }
if (!(Test-Path -LiteralPath $androidRoot)) { throw 'Android native project is missing. Run Expo prebuild first.' }

$env:JAVA_HOME = $jdkHome
$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot
$env:NODE_ENV = 'production'
# Native React headers can exceed the legacy Windows MAX_PATH limit when Gradle's
# transform cache lives below the project. Keep the cache project-specific but short.
$env:GRADLE_USER_HOME = Join-Path ([System.IO.Path]::GetPathRoot($projectRoot)) 'zxg'
$jdkPipeCompatibility = Enable-JdkPipeCompatibility $jdkHome

# CMake persists absolute prefab header paths. If the Gradle cache location changes,
# remove only regenerable native metadata so it cannot keep referencing the old path.
$cacheStamp = Join-Path $toolRoot 'gradle-cache-path.txt'
$previousGradleHome = if (Test-Path -LiteralPath $cacheStamp) {
  (Get-Content -LiteralPath $cacheStamp -Raw).Trim()
} else {
  Join-Path $toolRoot 'gradle-home'
}
if ($previousGradleHome -ne $env:GRADLE_USER_HOME) {
  $nativeMetadataRoots = @(
    (Join-Path $androidRoot 'app\.cxx'),
    (Join-Path $projectRoot 'node_modules\react-native-screens\android\.cxx'),
    (Join-Path $projectRoot 'node_modules\react-native-gesture-handler\android\.cxx'),
    (Join-Path $projectRoot 'node_modules\react-native-reanimated\android\.cxx'),
    (Join-Path $projectRoot 'node_modules\react-native-worklets\android\.cxx'),
    (Join-Path $projectRoot 'node_modules\expo-modules-core\android\.cxx')
  )
  foreach ($metadataRoot in $nativeMetadataRoots) {
    $absoluteMetadataRoot = [System.IO.Path]::GetFullPath($metadataRoot)
    if (!$absoluteMetadataRoot.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove native metadata outside the project: $absoluteMetadataRoot"
    }
    if (Test-Path -LiteralPath $absoluteMetadataRoot) {
      Remove-Item -LiteralPath $absoluteMetadataRoot -Recurse -Force
    }
  }
  Set-Content -LiteralPath $cacheStamp -Value $env:GRADLE_USER_HOME -Encoding ascii
}

$sdkProperty = $sdkRoot.Replace('\', '/')
Set-Content -LiteralPath (Join-Path $androidRoot 'local.properties') -Value "sdk.dir=$sdkProperty" -Encoding ascii

Push-Location $androidRoot
try {
  $gradleArguments = @('app:assembleRelease', '--stacktrace', '--no-daemon')
  if ($jdkPipeCompatibility) {
    $env:JAVA_OPTS = (($env:JAVA_OPTS, $jdkPipeCompatibility) | Where-Object { $_ }) -join ' '
    $daemonJvmArguments = "$jdkPipeCompatibility -Xmx2048m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8 -Duser.country=US -Duser.language=en -Duser.variant"
    $gradleArguments += "-Dorg.gradle.jvmargs=$daemonJvmArguments"
    Write-Host 'JDK_PIPE_COMPATIBILITY=TCP_LOOPBACK'
  }
  & (Join-Path $gradleInstall 'bin\gradle.bat') @gradleArguments
  if ($LASTEXITCODE -ne 0) { throw "Gradle release build failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}

$builtApk = Join-Path $androidRoot 'app\build\outputs\apk\release\app-release.apk'
if (!(Test-Path -LiteralPath $builtApk)) { throw 'Gradle succeeded but the release APK was not found.' }
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
Copy-Item -LiteralPath $builtApk -Destination $artifact -Force

$apksigner = Join-Path $sdkRoot 'build-tools\36.0.0\apksigner.bat'
$aapt = Join-Path $sdkRoot 'build-tools\36.0.0\aapt.exe'
& $apksigner verify --verbose --print-certs $artifact
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
& $aapt dump badging $artifact | Select-Object -First 8

$apkInfo = Get-Item -LiteralPath $artifact
$apkHash = Get-Sha256Hex $artifact
Write-Host "APK_READY=$($apkInfo.FullName)"
Write-Host "APK_BYTES=$($apkInfo.Length)"
Write-Host "APK_SHA256=$apkHash"
