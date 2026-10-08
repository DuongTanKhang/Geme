param(
  [Parameter(Mandatory = $true)]
  [string] $ArchivePath,
  [string] $ApiBase = "http://127.0.0.1:4000/api/v1"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$draftRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "../../geme/content/journal-drafts"))
$archiveFullPath = (Resolve-Path -LiteralPath $ArchivePath).Path
$ApiBase = $ApiBase.TrimEnd("/")
$imageNames = @(
  "01-gemstone-story.png",
  "02-opal.png",
  "03-personal-style.png",
  "04-silver-care.png",
  "05-green-gemstones.png",
  "06-first-ring.png",
  "07-craftsmanship.png"
)
$categoriesToKeep = @("Kiến thức đá quý", "Phong cách", "Chăm sóc trang sức", "Chuyện GEME")

function Invoke-GemeApi([string] $Path, [string] $Method = "GET", $Body = $null) {
  $arguments = @{ Uri = "$ApiBase/$Path"; Method = $Method; TimeoutSec = 120 }
  if ($null -ne $Body) {
    $arguments.ContentType = "application/json; charset=utf-8"
    $arguments.Body = ConvertTo-Json -InputObject $Body -Depth 12 -Compress
  }
  return Invoke-RestMethod -UseBasicParsing @arguments
}

function Read-Draft([string] $Path) {
  $raw = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $match = [regex]::Match($raw, "(?s)^---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)$")
  if (-not $match.Success) { throw "Draft front matter is invalid: $([System.IO.Path]::GetFileName($Path))" }
  $meta = @{}
  foreach ($line in ($match.Groups[1].Value -split "\r?\n")) {
    if ($line -match "^([A-Za-z][A-Za-z0-9]*):\s*(.*)$") { $meta[$Matches[1]] = $Matches[2] }
  }
  foreach ($required in @("title", "slug", "category", "summary", "coverImageUrl", "coverImageAlt", "seoTitle", "seoDescription", "tags")) {
    if (-not $meta.ContainsKey($required) -or -not $meta[$required]) { throw "Missing '$required' in $([System.IO.Path]::GetFileName($Path))" }
  }
  return @{ Meta = $meta; Content = $match.Groups[2].Value.Trim() }
}

function Get-ImageUrls([string] $Content, [string] $CoverUrl) {
  $ordered = [System.Collections.Generic.List[string]]::new()
  $ordered.Add($CoverUrl)
  foreach ($match in [regex]::Matches($Content, '<img\b[^>]*\bsrc\s*=\s*(["''])(.*?)\1', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    $url = $match.Groups[2].Value
    if ($url -and -not $ordered.Contains($url)) { $ordered.Add($url) }
  }
  return $ordered.ToArray()
}

$draftFiles = @(Get-ChildItem -LiteralPath $draftRoot -Filter "*.md" | Sort-Object Name)
if ($draftFiles.Count -ne 7) { throw "Expected seven article drafts; found $($draftFiles.Count)." }
$drafts = @($draftFiles | ForEach-Object { Read-Draft $_.FullName })
$existing = @(Invoke-GemeApi "blog?all=true&limit=500")
$existingSlugs = @($existing | ForEach-Object { $_.slug })
$conflictingSlugs = @($drafts | Where-Object { $_.Meta.slug -in $existingSlugs } | ForEach-Object { $_.Meta.slug })
if ($conflictingSlugs.Count) {
  Write-Output "Skipped existing slugs (records left untouched): $($conflictingSlugs -join ', ')"
}
$drafts = @($drafts | Where-Object { $_.Meta.slug -notin $conflictingSlugs })
if (-not $drafts.Count) { Write-Output "No new drafts to import."; exit 0 }

$settings = Invoke-GemeApi "settings"
$existingCategories = @()
if ($settings.blogCategories -is [System.Array]) { $existingCategories = @($settings.blogCategories | ForEach-Object { [string] $_ }) }
$mergedCategories = [System.Collections.Generic.List[string]]::new()
foreach ($category in @($existingCategories + $categoriesToKeep)) {
  if ($category -and -not ($mergedCategories | Where-Object { $_.Equals($category, [StringComparison]::OrdinalIgnoreCase) })) { $mergedCategories.Add($category) }
}
$separator = [string][char]31
if (($existingCategories -join $separator) -ne ($mergedCategories.ToArray() -join $separator)) {
  $null = Invoke-GemeApi "settings" "PATCH" @{ blogCategories = $mergedCategories.ToArray() }
}

$assetUrls = @{}
$mediaRows = @(Invoke-GemeApi "media")
$zip = [System.IO.Compression.ZipFile]::OpenRead($archiveFullPath)
try {
  foreach ($imageName in $imageNames) {
    $entry = $zip.GetEntry("images/$imageName")
    if (-not $entry) { throw "Missing archive image: images/$imageName" }
    $stream = $entry.Open()
    $memory = [System.IO.MemoryStream]::new()
    try { $stream.CopyTo($memory); $bytes = $memory.ToArray() }
    finally { $memory.Dispose(); $stream.Dispose() }

    $digestBytes = [System.Security.Cryptography.SHA256]::HashData($bytes)
    $digest = [Convert]::ToHexString($digestBytes).ToLowerInvariant().Substring(0, 12)
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($imageName)
    $sourceKey = "assets/geme-journal-draft-$digest-$imageName"
    $existingMedia = $mediaRows | Where-Object { $_.sourceKey -eq $sourceKey } | Select-Object -First 1
    if ($existingMedia) {
      $assetUrls[$imageName] = "/assets/geme-journal-draft-$digest-$imageName"
      continue
    }
    $numberedAlt = switch ($stem) {
      "01-gemstone-story" { "Ảnh minh họa bằng AI về bàn tay dùng nhíp quan sát một viên đá xanh cạnh kính lúp." }
      "02-opal" { "Ảnh minh họa bằng AI về một viên Opal nhiều màu trên nền sáng trung tính." }
      "03-personal-style" { "Ảnh minh họa bằng AI về cách phối trang sức đá màu với trang phục." }
      "04-silver-care" { "Ảnh minh họa bằng AI về khăn mềm và trang sức bạc trơn." }
      "05-green-gemstones" { "Ảnh minh họa bằng AI về đá quý có sắc xanh lục và xanh lam." }
      "06-first-ring" { "Ảnh minh họa bằng AI về một chiếc nhẫn đá màu." }
      "07-craftsmanship" { "Ảnh minh họa bằng AI về công đoạn quan sát và hoàn thiện trang sức." }
    }
    $payload = @{
      filename = $imageName
      sourceKey = $sourceKey
      mimeType = "image/png"
      base64 = [Convert]::ToBase64String($bytes)
      alt = $numberedAlt
    }
    $asset = Invoke-GemeApi "media" "POST" $payload
    $assetUrls[$imageName] = $asset.url
    Write-Output "Stored CMS image: $imageName"
  }

  $created = [System.Collections.Generic.List[string]]::new()
  foreach ($draft in $drafts) {
    $meta = $draft.Meta
    $content = $draft.Content
    foreach ($imageName in $imageNames) {
      $placeholder = "/assets/geme-journal-draft-$($imageName.Substring(0, 2))-$([System.IO.Path]::GetFileNameWithoutExtension($imageName).Substring(3)).png"
      if ($content.Contains($placeholder)) { $content = $content.Replace($placeholder, $assetUrls[$imageName]) }
    }
    $coverName = [System.IO.Path]::GetFileName($meta.coverImageUrl)
    $imageName = $imageNames | Where-Object { $meta.coverImageUrl -match "draft-$($_.Substring(0, 2))-" } | Select-Object -First 1
    if (-not $imageName) { throw "Could not map cover image for slug $($meta.slug)." }
    $coverUrl = $assetUrls[$imageName]
    $contentImages = Get-ImageUrls $content $coverUrl
    $images = @()
    foreach ($url in $contentImages) {
      $alt = if ($url -eq $coverUrl) { $meta.coverImageAlt } else {
        $tagPattern = '(?is)<img\b(?=[^>]*\bsrc\s*=\s*(["''])' + [regex]::Escape($url) + '\1)[^>]*>'
        $tagMatch = [regex]::Match($content, $tagPattern)
        $altMatch = if ($tagMatch.Success) { [regex]::Match($tagMatch.Value, '\balt\s*=\s*(["''])(.*?)\1', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) } else { $null }
        if ($altMatch -and $altMatch.Success) { [System.Net.WebUtility]::HtmlDecode($altMatch.Groups[2].Value) } else { $meta.title }
      }
      $images += @{ url = $url; alt = $alt }
    }
    $tags = @($meta.tags -split ",\s*" | Where-Object { $_ })
    $post = @{
      title = $meta.title
      slug = $meta.slug
      summary = $meta.summary
      category = $meta.category
      tags = $tags
      content = $content
      coverImageUrl = $coverUrl
      coverImageAlt = $meta.coverImageAlt
      images = $images
      status = "DRAFT"
      seoTitle = $meta.seoTitle
      seoDescription = $meta.seoDescription
    }
    $saved = Invoke-GemeApi "blog" "POST" $post
    $created.Add($saved.slug)
    Write-Output "Created draft: $($saved.title) [$($saved.slug)]"
  }
  Write-Output "Imported $($created.Count) draft articles; none were published."
}
finally { $zip.Dispose() }
