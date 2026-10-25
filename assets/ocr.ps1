param(
  [Parameter(Mandatory = $true)][string]$ImagePath,
  [Parameter(Mandatory = $true)][string]$OutPath
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ ok = $false; lang = ''; lines = @(); error = '' }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }
  [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
  [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
  [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { throw 'No OCR language pack installed' }
  $result.lang = $engine.RecognizerLanguage.LanguageTag
  $ocr = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  # 脚本端同样限制行数与总字符数，防止超大图先撑爆脚本内存/结果文件；
  # 父端 ocr.js 的行数/字符上限是第二道防线。
  $maxLines = 10000
  $maxText = 524288
  $total = 0
  $lines = @()
  foreach ($line in $ocr.Lines) {
    if (-not $line.Text) { continue }
    if ($lines.Count -ge $maxLines) { break }
    $t = $line.Text
    $remaining = $maxText - $total
    if ($t.Length -gt $remaining) {
      if ($remaining -le 0) { break }
      $t = $t.Substring(0, $remaining)
    }
    $lines += $t
    $total += $t.Length
    if ($total -ge $maxText) { break }
  }
  $result.lines = $lines
  $result.ok = $true
  $stream.Dispose()
} catch {
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))
