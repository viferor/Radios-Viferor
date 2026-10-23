# Comprobación rápida sin red ni Python: monta tests/smoke/test.html a partir de index.html,
# lo abre con el Chromium que ya está instalado y muestra el resultado.
# (La salida de Chromium se recoge con cmd porque, lanzado desde PowerShell, se pierde.)
# Uso, desde la raíz del repo:  powershell -ExecutionPolicy Bypass -File tests\smoke\run.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$chrome = Join-Path $env:LOCALAPPDATA 'ms-playwright\chromium-1248\chrome-win64\chrome.exe'
if (-not (Test-Path $chrome)) { throw "No encuentro Chromium en $chrome" }

$html = Get-Content (Join-Path $root 'index.html') -Raw -Encoding UTF8
$pre = Get-Content (Join-Path $PSScriptRoot 'pre.js') -Raw -Encoding UTF8
$post = Get-Content (Join-Path $PSScriptRoot 'tests.js') -Raw -Encoding UTF8
# <base href="../"> para que los app.js?v=… de index.html se encuentren desde tests/smoke/.
$html = $html.Replace('<head>', "<head>`n<base href=`"../../`">`n<script>`n$pre`n</script>")
$html = $html.Replace('</body>', "<script>`n$post`n</script>`n</body>")
$testFile = Join-Path $PSScriptRoot 'test.html'
[System.IO.File]::WriteAllText($testFile, $html, (New-Object System.Text.UTF8Encoding($false)))

$url = 'file:///' + ($testFile -replace '\\', '/')
$url = $url -replace ' ', '%20'
$perfil = Join-Path $env:TEMP ('rv-dom-' + [guid]::NewGuid().ToString('N'))
$dump = Join-Path $PSScriptRoot 'dump.html'
$err = Join-Path $PSScriptRoot 'dump.err'
# 15 s de tiempo virtual: la página tiene un temporizador que no para y con más se cuelga.
cmd /c "`"$chrome`" --headless --no-sandbox --disable-gpu --dump-dom --virtual-time-budget=15000 --allow-file-access-from-files --user-data-dir=`"$perfil`" --no-first-run `"$url`" > `"$dump`" 2> `"$err`""
$texto = Get-Content $dump -Raw -Encoding UTF8
$i = $texto.LastIndexOf('RESULTADOS')
if ($i -lt 0) {
  Write-Output 'No se encontró el bloque RESULTADOS.'
  Write-Output ('Longitud del volcado: ' + $texto.Length)
  Write-Output (Get-Content $err -Raw | Select-Object -First 1)
  exit 1
}
$fin = $texto.IndexOf('FIN', $i)
$texto.Substring($i, [Math]::Min($texto.Length - $i, $fin - $i + 3))
