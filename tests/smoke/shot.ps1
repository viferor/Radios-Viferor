# Hace una captura de una pantalla de la web con Chromium (para revisar el diseño).
# Uso: powershell -ExecutionPolicy Bypass -File tests\smoke\shot.ps1 [ancho] [alto]
param([int]$Ancho = 390, [int]$Alto = 844, [string]$Pantalla = 'queue')
$ErrorActionPreference = 'Stop'
$smoke = $PSScriptRoot
$root = Split-Path -Parent (Split-Path -Parent $smoke)
$chrome = Join-Path $env:LOCALAPPDATA 'ms-playwright\chromium-1248\chrome-win64\chrome.exe'
if (-not (Test-Path $chrome)) { throw "No encuentro Chromium en $chrome" }

$html = Get-Content (Join-Path $root 'index.html') -Raw -Encoding UTF8
$pre = Get-Content (Join-Path $smoke 'pre.js') -Raw -Encoding UTF8
$post = Get-Content (Join-Path $smoke 'shot.js') -Raw -Encoding UTF8
$html = $html.Replace('<head>', "<head>`n<base href=`"../../`">`n<script>`n$pre`n</script>")
$html = $html.Replace('</body>', "<script>`n$post`n</script>`n</body>")
$page = Join-Path $smoke 'shot.html'
[System.IO.File]::WriteAllText($page, $html, (New-Object System.Text.UTF8Encoding($false)))

$url = ('file:///' + ($page -replace '\\', '/')) + '?shot=' + $Pantalla -replace ' ', '%20'
$png = Join-Path $smoke ('captura-' + $Pantalla + '.png')
$perfil = Join-Path $env:TEMP ('rv-shot-' + [guid]::NewGuid().ToString('N'))
cmd /c "`"$chrome`" --headless --no-sandbox --disable-gpu --window-size=$Ancho,$Alto --screenshot=`"$png`" --virtual-time-budget=9000 --allow-file-access-from-files --user-data-dir=`"$perfil`" --no-first-run `"$url`" 2>NUL"
if (Test-Path $png) { Write-Output ("Captura: " + $png) } else { Write-Output 'No se generó la captura' }
