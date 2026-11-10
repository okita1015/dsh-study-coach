# make-payme.ps1 —— 把手机截的收款码裁成面板能用的 600x600 白底正方形
#
#   powershell -ExecutionPolicy Bypass -File assets/make-payme.ps1 -In "C:/Users/you/Desktop/wechat.png"
#   powershell -ExecutionPolicy Bypass -File assets/make-payme.ps1 -In "..." -Out "assets/payme.png"
#
# 做三件事：
#   1. 等比缩放塞进 600x600，四周留 36px 白边（二维码贴边会扫不出来）
#   2. 白底填充，透明 PNG 也不会变黑
#   3. 输出固定 PNG，体积通常 20~60 KB
#
# 微信「保存收款码」的图上面带一条昵称+头像，先用画图/截图工具裁掉再跑这个；
# 这个脚本不认人，整张图都当二维码处理。

param(
  [Parameter(Mandatory = $true)][string]$In,
  [string]$Out = '',
  [int]$Size = 600,
  [int]$Margin = 36
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $In)) {
  Write-Host "找不到输入文件：$In" -ForegroundColor Red
  exit 1
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($Out)) { $Out = Join-Path $dir 'payme.png' }
if (-not [System.IO.Path]::IsPathRooted($Out)) { $Out = Join-Path (Get-Location) $Out }
$Out = [System.IO.Path]::GetFullPath($Out)

$src = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $In))
try {
  $box = $Size - ($Margin * 2)
  $scale = [Math]::Min($box / $src.Width, $box / $src.Height)
  $w = [int][Math]::Round($src.Width * $scale)
  $h = [int][Math]::Round($src.Height * $scale)

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $bmp.SetResolution(96, 96)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  # 最近邻会让二维码变糊，这里用高质量双三次
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.SmoothingMode = 'HighQuality'
  $x = [int](($Size - $w) / 2)
  $y = [int](($Size - $h) / 2)
  $g.DrawImage($src, $x, $y, $w, $h)
  $g.Dispose()

  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  $kb = [Math]::Round((Get-Item -LiteralPath $Out).Length / 1KB, 1)
  Write-Host "已生成：$Out" -ForegroundColor Green
  Write-Host "  ${Size}x${Size} · ${kb} KB · 原图 $($src.Width)x$($src.Height)"

  if ([int]$kb -gt 400) {
    Write-Host "  体积偏大：二维码一般 60KB 以内，这张可能有噪点或渐变" -ForegroundColor Yellow
  }
} finally {
  $src.Dispose()
}
