param(
  [string]$OutputDir = "store-assets"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$assetRoot = Join-Path $projectRoot $OutputDir
New-Item -ItemType Directory -Force -Path $assetRoot | Out-Null

$fontName = "Segoe UI"
$fontBold = [System.Drawing.FontStyle]::Bold
$fontRegular = [System.Drawing.FontStyle]::Regular

function New-Font($size, $style = $fontRegular) {
  New-Object System.Drawing.Font $fontName, $size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
}

function New-Color($hex) {
  [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-Brush($hex) {
  New-Object System.Drawing.SolidBrush (New-Color $hex)
}

function New-Pen($hex, $width) {
  $pen = New-Object System.Drawing.Pen (New-Color $hex), $width
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pen
}

function New-RoundPath($x, $y, $w, $h, $r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = [Math]::Max(1, $r * 2)
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $path
}

function Fill-Round($g, $x, $y, $w, $h, $r, $hex) {
  $path = New-RoundPath $x $y $w $h $r
  $brush = New-Brush $hex
  $g.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()
}

function Stroke-Round($g, $x, $y, $w, $h, $r, $hex, $lineWidth = 1) {
  $path = New-RoundPath $x $y $w $h $r
  $pen = New-Pen $hex $lineWidth
  $g.DrawPath($pen, $path)
  $pen.Dispose()
  $path.Dispose()
}

function Draw-HText($g, $text, $size, $style, $hex, $x, $y, $w, $h, $align = "Near", $line = "Near") {
  $font = New-Font $size $style
  $brush = New-Brush $hex
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionRightToLeft
  $fmt.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  if ($align -eq "Center") { $fmt.Alignment = [System.Drawing.StringAlignment]::Center }
  elseif ($align -eq "Far") { $fmt.Alignment = [System.Drawing.StringAlignment]::Far }
  else { $fmt.Alignment = [System.Drawing.StringAlignment]::Near }
  if ($line -eq "Center") { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center }
  elseif ($line -eq "Far") { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Far }
  else { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near }
  $rect = New-Object System.Drawing.RectangleF $x, $y, $w, $h
  $g.DrawString($text, $font, $brush, $rect, $fmt)
  $fmt.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

function Draw-LText($g, $text, $size, $style, $hex, $x, $y, $w, $h, $align = "Near", $line = "Near") {
  $font = New-Font $size $style
  $brush = New-Brush $hex
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
  if ($align -eq "Center") { $fmt.Alignment = [System.Drawing.StringAlignment]::Center }
  elseif ($align -eq "Far") { $fmt.Alignment = [System.Drawing.StringAlignment]::Far }
  else { $fmt.Alignment = [System.Drawing.StringAlignment]::Near }
  if ($line -eq "Center") { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center }
  elseif ($line -eq "Far") { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Far }
  else { $fmt.LineAlignment = [System.Drawing.StringAlignment]::Near }
  $rect = New-Object System.Drawing.RectangleF $x, $y, $w, $h
  $g.DrawString($text, $font, $brush, $rect, $fmt)
  $fmt.Dispose()
  $brush.Dispose()
  $font.Dispose()
}

function Draw-Icon($g, $x, $y, $s) {
  Fill-Round $g $x $y $s $s ($s * 0.20) "#0f766e"
  Fill-Round $g ($x + $s * 0.26) ($y + $s * 0.16) ($s * 0.48) ($s * 0.66) ($s * 0.05) "#f8fafc"
  $fold = @(
    (New-Object System.Drawing.PointF ($x + $s * 0.60), ($y + $s * 0.16)),
    (New-Object System.Drawing.PointF ($x + $s * 0.74), ($y + $s * 0.30)),
    (New-Object System.Drawing.PointF ($x + $s * 0.60), ($y + $s * 0.30))
  )
  $foldBrush = New-Brush "#67e8f9"
  $g.FillPolygon($foldBrush, $fold)
  $foldBrush.Dispose()
  $penA = New-Pen "#0f766e" ([Math]::Max(3, $s * 0.055))
  $g.DrawLine($penA, ($x + $s * 0.34), ($y + $s * 0.42), ($x + $s * 0.67), ($y + $s * 0.42))
  $penA.Dispose()
  $penB = New-Pen "#155e75" ([Math]::Max(2, $s * 0.045))
  $g.DrawLine($penB, ($x + $s * 0.34), ($y + $s * 0.54), ($x + $s * 0.59), ($y + $s * 0.54))
  $penB.Dispose()
  $badge = New-Brush "#f97316"
  $g.FillEllipse($badge, ($x + $s * 0.60), ($y + $s * 0.62), ($s * 0.28), ($s * 0.28))
  $badge.Dispose()
  $check = New-Pen "#ffffff" ([Math]::Max(2, $s * 0.04))
  $g.DrawLines($check, @(
    (New-Object System.Drawing.PointF ($x + $s * 0.67), ($y + $s * 0.76)),
    (New-Object System.Drawing.PointF ($x + $s * 0.72), ($y + $s * 0.81)),
    (New-Object System.Drawing.PointF ($x + $s * 0.82), ($y + $s * 0.70))
  ))
  $check.Dispose()
}

function Draw-AppMock($g, $x, $y, $w, $h, $mode) {
  Fill-Round $g $x $y $w $h 28 "#ffffff"
  Stroke-Round $g $x $y $w $h 28 "#dbe4ef" 2
  Fill-Round $g ($x + $w - 310) ($y + 18) 286 ($h - 36) 20 "#f8fafc"
  Draw-HText $g "PDF יומי" 27 $fontBold "#0f172a" ($x + $w - 280) ($y + 38) 190 42
  Draw-HText $g "פתח או גרור PDF לכאן" 20 $fontBold "#0f766e" ($x + $w - 275) ($y + 102) 210 36
  Fill-Round $g ($x + $w - 280) ($y + 154) 225 72 16 "#ecfeff"
  Draw-HText $g "ניווט מהיר" 18 $fontBold "#0f172a" ($x + $w - 262) ($y + 170) 170 26
  Draw-HText $g "עמוד 14 / 42" 15 $fontRegular "#475569" ($x + $w - 262) ($y + 197) 170 24
  Fill-Round $g ($x + $w - 280) ($y + 246) 225 124 16 "#f1f5f9"
  Draw-HText $g "תוכן עניינים" 18 $fontBold "#0f172a" ($x + $w - 262) ($y + 263) 170 24
  Draw-HText $g "מבוא`nטפסים וחתימות`nנספחים" 15 $fontRegular "#475569" ($x + $w - 262) ($y + 295) 170 70
  Fill-Round $g ($x + $w - 280) ($y + 390) 225 140 16 "#fff7ed"
  Draw-HText $g "פעולות מהירות" 18 $fontBold "#0f172a" ($x + $w - 262) ($y + 407) 170 24
  Draw-HText $g "שמור מיקום`nחתימה`nשמור PDF" 15 $fontRegular "#475569" ($x + $w - 262) ($y + 440) 170 80

  Fill-Round $g ($x + 24) ($y + 18) ($w - 352) 58 18 "#f8fafc"
  $tools = @("רציף", "דף", "ספר RTL", "חיפוש", "שמירה", "הדפסה")
  $tx = $x + $w - 372
  foreach ($tool in $tools) {
    $pillW = if ($tool.Length -gt 5) { 92 } else { 70 }
    Fill-Round $g ($tx - $pillW) ($y + 31) $pillW 30 12 "#ffffff"
    Stroke-Round $g ($tx - $pillW) ($y + 31) $pillW 30 12 "#dbe4ef" 1
    Draw-HText $g $tool 13 $fontBold "#334155" ($tx - $pillW + 9) ($y + 37) ($pillW - 18) 20 "Center" "Center"
    $tx -= ($pillW + 10)
  }

  $pageX = $x + 108
  $pageY = $y + 108
  $pageW = $w - 500
  $pageH = $h - 148
  Fill-Round $g $pageX $pageY $pageW $pageH 18 "#e2e8f0"
  Fill-Round $g ($pageX + 84) ($pageY + 34) ($pageW - 168) ($pageH - 68) 8 "#ffffff"
  Draw-HText $g "מסמך לדוגמה" 31 $fontBold "#0f172a" ($pageX + 144) ($pageY + 72) ($pageW - 288) 44 "Center"
  Draw-HText $g "טופס קריאה, סימון וחתימה" 21 $fontRegular "#475569" ($pageX + 144) ($pageY + 122) ($pageW - 288) 34 "Center"
  $linePen = New-Pen "#cbd5e1" 9
  for ($i = 0; $i -lt 7; $i++) {
    $ly = $pageY + 190 + ($i * 44)
    $g.DrawLine($linePen, ($pageX + 160), $ly, ($pageX + $pageW - 160), $ly)
  }
  $linePen.Dispose()

  if ($mode -eq "annotations") {
    $high = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(140, 250, 204, 21))
    $g.FillRectangle($high, ($pageX + 220), ($pageY + 232), ($pageW - 440), 26)
    $high.Dispose()
    Fill-Round $g ($pageX + 200) ($pageY + 390) 175 54 12 "#fff7ed"
    Draw-HText $g "חתימה שמורה" 17 $fontBold "#9a3412" ($pageX + 218) ($pageY + 404) 130 26 "Center" "Center"
    $sig = New-Pen "#0f766e" 5
    $g.DrawCurve($sig, @(
      (New-Object System.Drawing.PointF ($pageX + 410), ($pageY + 430)),
      (New-Object System.Drawing.PointF ($pageX + 475), ($pageY + 388)),
      (New-Object System.Drawing.PointF ($pageX + 548), ($pageY + 430)),
      (New-Object System.Drawing.PointF ($pageX + 610), ($pageY + 396))
    ))
    $sig.Dispose()
  } elseif ($mode -eq "search") {
    Fill-Round $g ($pageX + 170) ($pageY + 205) 300 44 14 "#ecfeff"
    Draw-HText $g "חיפוש במסמך: חוזה" 19 $fontBold "#0f766e" ($pageX + 190) ($pageY + 216) 250 24 "Center" "Center"
    $hit = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, 253, 186, 116))
    $g.FillRectangle($hit, ($pageX + 330), ($pageY + 320), 220, 28)
    $g.FillRectangle($hit, ($pageX + 260), ($pageY + 408), 260, 28)
    $hit.Dispose()
  } elseif ($mode -eq "export") {
    Fill-Round $g ($pageX + 180) ($pageY + 235) 360 190 18 "#f8fafc"
    Stroke-Round $g ($pageX + 180) ($pageY + 235) 360 190 18 "#cbd5e1" 2
    Draw-HText $g "שמור, צלם או הדפס" 26 $fontBold "#0f172a" ($pageX + 220) ($pageY + 265) 280 40 "Center"
    Draw-HText $g "עמוד מלא, חלון נוכחי או אזור מסומן" 19 $fontRegular "#475569" ($pageX + 220) ($pageY + 313) 280 58 "Center"
    Fill-Round $g ($pageX + 265) ($pageY + 370) 190 42 16 "#f97316"
    Draw-HText $g "ייצוא PDF" 18 $fontBold "#ffffff" ($pageX + 292) ($pageY + 379) 136 24 "Center" "Center"
  } elseif ($mode -eq "book") {
    Fill-Round $g ($pageX + 90) ($pageY + 34) (($pageW - 200) / 2) ($pageH - 68) 8 "#ffffff"
    Stroke-Round $g ($pageX + 90) ($pageY + 34) (($pageW - 200) / 2) ($pageH - 68) 8 "#cbd5e1" 1
    Fill-Round $g ($pageX + ($pageW / 2) + 10) ($pageY + 34) (($pageW - 200) / 2) ($pageH - 68) 8 "#ffffff"
    Stroke-Round $g ($pageX + ($pageW / 2) + 10) ($pageY + 34) (($pageW - 200) / 2) ($pageH - 68) 8 "#cbd5e1" 1
    Draw-HText $g "מצב ספר RTL" 31 $fontBold "#0f172a" ($pageX + 170) ($pageY + 82) ($pageW - 340) 48 "Center"
  }
}

function Draw-Header($g, $title, $subtitle, $accent, $w) {
  Draw-HText $g $title 39 $fontBold "#0f172a" 510 54 ($w - 580) 58
  Draw-HText $g $subtitle 24 $fontRegular "#475569" 510 126 ($w - 580) 78
  Draw-Icon $g 74 52 122
  Fill-Round $g 210 90 260 52 18 $accent
  Draw-HText $g "קורא PDF יומי" 24 $fontBold "#ffffff" 238 101 204 32 "Center" "Center"
}

function Create-Screenshot($fileName, $title, $subtitle, $mode, $chips) {
  $path = Join-Path $assetRoot $fileName
  $bmp = New-Object System.Drawing.Bitmap 1280, 800
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear((New-Color "#f6f8fb"))
  Draw-Header $g $title $subtitle "#0f766e" 1280
  Draw-AppMock $g 74 225 1132 500 $mode
  $cx = 1170
  foreach ($chip in $chips) {
    $cw = 210
    Fill-Round $g ($cx - $cw) 710 $cw 44 16 "#ffffff"
    Stroke-Round $g ($cx - $cw) 710 $cw 44 16 "#cbd5e1" 1
    Draw-HText $g $chip 17 $fontBold "#0f172a" ($cx - $cw + 16) 721 ($cw - 32) 24 "Center" "Center"
    $cx -= ($cw + 18)
  }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Create-PromoSmall() {
  $path = Join-Path $assetRoot "promo-small-440x280.png"
  $bmp = New-Object System.Drawing.Bitmap 440, 280
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear((New-Color "#0f766e"))
  Fill-Round $g 18 18 404 244 30 "#ffffff"
  Draw-Icon $g 292 46 92
  Draw-HText $g "קורא PDF יומי" 28 $fontBold "#0f172a" 48 46 222 40
  Draw-HText $g "עברית, חתימות, סימניות ושמירה" 18 $fontRegular "#475569" 48 95 222 62
  Fill-Round $g 48 184 204 42 16 "#f97316"
  Draw-HText $g "עובדים מהר יותר" 18 $fontBold "#ffffff" 68 194 164 22 "Center" "Center"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Create-Marquee() {
  $path = Join-Path $assetRoot "marquee-1400x560.png"
  $bmp = New-Object System.Drawing.Bitmap 1400, 560
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear((New-Color "#f8fafc"))
  Fill-Round $g 42 42 1316 476 42 "#0f766e"
  Draw-Icon $g 1110 106 168
  Draw-HText $g "קורא PDF עברי, מהיר ונוח לשימוש יומיומי" 48 $fontBold "#ffffff" 145 92 890 122
  Draw-HText $g "קוראים, מחפשים, מסמנים, ממלאים, חותמים ושומרים עותק PDF חדש. הכול בממשק עברי זורם שמתאים לעבודה אמיתית עם מסמכים." 29 $fontRegular "#dffdf8" 145 222 860 105
  $chips = @("מצב ספר RTL", "חתימה וטפסים", "שמירה מקומית", "ייצוא PDF")
  $x = 1015
  foreach ($chip in $chips) {
    Fill-Round $g ($x - 205) 390 205 46 17 "#ffffff"
    Draw-HText $g $chip 17 $fontBold "#0f766e" ($x - 191) 401 177 24 "Center" "Center"
    $x -= 225
  }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

Create-Screenshot "screenshot-01-reader-1280x800.png" "קורא PDF עברי לעבודה יומיומית" "פותחים קובץ, קוראים בנוחות, ושומרים את ההתקדמות לכל מסמך." "default" @("פתיחה מהירה", "שמירת מיקום", "ממשק עברי")
Create-Screenshot "screenshot-02-rtl-book-1280x800.png" "קריאה טבעית בעברית ובאנגלית" "מצב ספר RTL למסמכים בעברית, לצד תצוגה רציפה ודף יחיד." "book" @("ספר RTL", "ספר LTR", "זום נוח")
Create-Screenshot "screenshot-03-annotations-1280x800.png" "מסמנים, ממלאים וחותמים במקום" "הדגשות, הערות, שדות טקסט וחתימות שמורות למסמכים הבאים." "annotations" @("חתימות", "הדגשות", "מילוי מהיר")
Create-Screenshot "screenshot-04-search-bookmarks-1280x800.png" "מוצאים מהר וחוזרים בדיוק למקום" "חיפוש במסמך, סימניות, תוכן עניינים ושמירת מיקום קריאה אחרון." "search" @("חיפוש", "סימניות", "תוכן עניינים")
Create-Screenshot "screenshot-05-export-print-1280x800.png" "שומרים ומשתפים רק את מה שצריך" "ייצוא PDF עם התוספות, צילום עמוד או אזור מסומן ואפשרויות הדפסה חכמות." "export" @("ייצוא PDF", "צילום אזור", "הדפסה")
Create-PromoSmall
Create-Marquee

Write-Host "Store assets generated in:"
Write-Host $assetRoot
