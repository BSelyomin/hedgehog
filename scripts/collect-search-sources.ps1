param([string]$OutputPath = '.cache/search-sources.json')
$ErrorActionPreference = 'Stop'

# Public primary-source release excerpts. No article text is invented or AI-written.
$feeds = @(
    @{ Url = 'https://www.federalreserve.gov/feeds/press_monetary.xml'; HostName = 'www.federalreserve.gov' },
    @{ Url = 'https://www.eia.gov/rss/todayinenergy.xml'; HostName = 'www.eia.gov' },
    @{ Url = 'https://www.bls.gov/feed/bls_latest.rss'; HostName = 'www.bls.gov' }
)
$rows = @()
$seen = @{}
foreach ($feed in $feeds) {
    try {
        $response = Invoke-WebRequest -Uri $feed.Url -UseBasicParsing -TimeoutSec 20
        $xmlText = if ($response.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($response.Content) } else { [string]$response.Content }
        # Some Windows PowerShell responses decode the UTF-8 BOM as visible characters.
        $start = $xmlText.IndexOf('<?xml')
        if ($start -ge 0) { $xmlText = $xmlText.Substring($start) }
        $settings = New-Object System.Xml.XmlReaderSettings
        $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver = $null
        $reader = [System.Xml.XmlReader]::Create((New-Object System.IO.StringReader($xmlText)), $settings)
        $doc = New-Object System.Xml.XmlDocument
        $doc.XmlResolver = $null
        try { $doc.Load($reader) } finally { $reader.Dispose() }
        $count = 0
        foreach ($item in $doc.SelectNodes('/rss/channel/item')) {
            if ($count -ge 15) { break }
            $title = $item.SelectSingleNode('title').InnerText.Trim()
            $url = $item.SelectSingleNode('link').InnerText.Trim()
            $description = $item.SelectSingleNode('description').InnerText
            $dateText = $item.SelectSingleNode('pubDate').InnerText
            $uri = [uri]$url
            if ($uri.Scheme -ne 'https' -or $uri.Host -ne $feed.HostName -or $uri.UserInfo -or $seen.ContainsKey($url)) { continue }
            # Never guess the year for a malformed feed date.
            if ($dateText -notmatch '\b20\d{2}\b') { continue }
            $dateText = $dateText -replace '\bEST\b', '-05:00' -replace '\bEDT\b', '-04:00' -replace '\bGMT\b', '+00:00'
            $published = [DateTimeOffset]::MinValue
            if (-not [DateTimeOffset]::TryParse($dateText, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AllowWhiteSpaces, [ref]$published)) { continue }
            if ($published -lt [DateTimeOffset]::UtcNow.AddDays(-90) -or $published -gt [DateTimeOffset]::UtcNow.AddDays(1)) { continue }
            $plain = [Net.WebUtility]::HtmlDecode(($description -replace '<[^>]*>', ' ')) -replace '\s+', ' '
            $plain = $plain.Trim()
            if (-not $title -or -not $plain) { continue }
            $rows += [ordered]@{
                title = $title
                url = $url
                text = "$title. Published $($published.ToString('yyyy-MM-dd')). $plain"
                publishedAt = $published.ToUniversalTime().ToString('o')
                feedUrl = $feed.Url
            }
            $seen[$url] = $true
            $count++
        }
        Write-Host "Collected $count excerpts from $($feed.HostName)"
    } catch {
        Write-Warning "Feed unavailable or malformed: $($feed.Url). Other feeds will continue."
    }
}
if (-not $rows.Count) { throw 'No recent sources collected; existing index has not been changed.' }
$parent = Split-Path -Parent $OutputPath
if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
$json = ConvertTo-Json -InputObject @($rows) -Depth 4
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath), $json, (New-Object Text.UTF8Encoding($false)))
Write-Host "Saved $($rows.Count) source excerpts to $OutputPath"
