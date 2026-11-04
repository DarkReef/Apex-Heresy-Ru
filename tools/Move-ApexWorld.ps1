#Requires -Version 7.2
<#
.SYNOPSIS
Safely changes one confirmed Apex Heresy RU world's package id while Foundry is stopped.
.DESCRIPTION
Dry-run is the default. WorldPath must be the selected world's directory, not the
whole Foundry Data directory. This helper never scans or edits other worlds and
never edits LevelDB, documents, settings, flags, asset paths, or compendiums.

The legacy id dark-heresy is ALSO used by Vendare's unrelated Dark Heresy 2E.
Only use -ConfirmApexWorld for a world you KNOW was created/used with Apex Heresy.
The id alone cannot establish this. A genuine Vendare world is not compatible.

Before applying, install the released apex-heresy-ru system, stop the Foundry
server completely, and make a full backup of the selected world directory.
-FoundryStopped is your explicit acknowledgement; this script cannot verify a
remote server or every possible Foundry process. Keep it stopped until done.

Apply creates a new timestamped, non-overwriting backup of world.json, then
atomically replaces only its top-level system value. Every other byte is kept,
including systemVersion. Foundry defines systemVersion as the version for which
the world has been migrated, so it must not be fabricated by this helper:
https://foundryvtt.com/api/interfaces/foundry.packages.types.WorldManifestData.html#systemVersion
The system performs any document/settings migration when the world is launched.

The printed rollback command is ONLY for before the next world launch. After
runtime migration has run, restore the complete pre-migration world backup.
Do not use a manifest-only rollback on migrated databases.

Requires PowerShell 7.2 or later (pwsh), and a regular local directory/file.
Symbolic links and junctions in the world path or its ancestors are refused.
.EXAMPLE
pwsh -File .\Move-ApexWorld.ps1 -WorldPath 'D:\FoundryData\worlds\my-apex-world'
.EXAMPLE
pwsh -File .\Move-ApexWorld.ps1 -WorldPath 'D:\FoundryData\worlds\my-apex-world' -Apply -ConfirmApexWorld -FoundryStopped
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string] $WorldPath,
    [switch] $Apply,
    [switch] $ConfirmApexWorld,
    [switch] $FoundryStopped
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-RegularPath {
    param([Parameter(Mandatory = $true)][string] $Path)
    $candidate = $Path
    while ($candidate) {
        $entry = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
        if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing symbolic link/junction/reparse point: $candidate"
        }
        $parent = [IO.Directory]::GetParent($candidate)
        $candidate = if ($null -eq $parent) { $null } else { $parent.FullName }
    }
}

function Write-NewFile {
    param([string] $Path, [byte[]] $Bytes)
    # CreateNew is essential: no existing backup or temporary file is overwritten.
    $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $stream.Write($Bytes, 0, $Bytes.Length)
        $stream.Flush($true)
    }
    finally { $stream.Dispose() }
}

function Get-ByteHash {
    param([byte[]] $Bytes)
    return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($Bytes))
}

# Use a JSON parser to identify the top-level token, not a text replacement or
# JSON reserialization (which could alter precision, formatting, or other keys).
if (-not ('ApexWorldTransitionV1.ManifestPlan' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace ApexWorldTransitionV1 {
    public sealed class ManifestPlan {
        public byte[] UpdatedBytes { get; private set; }
        public string WorldId { get; private set; }
        public string WorldTitle { get; private set; }
        public string SystemVersion { get; private set; }

        private static string Display(JsonElement root, string key) {
            return root.TryGetProperty(key, out var value)
                ? (value.ValueKind == JsonValueKind.String ? value.GetString() : value.GetRawText())
                : "(absent; preserved)";
        }

        public static ManifestPlan Create(byte[] original) {
            int bom = original.Length >= 3 && original[0] == 0xEF && original[1] == 0xBB && original[2] == 0xBF ? 3 : 0;
            var payload = new ReadOnlyMemory<byte>(original, bom, original.Length - bom);
            using var document = JsonDocument.Parse(payload, new JsonDocumentOptions { MaxDepth = 128 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
                throw new InvalidOperationException("world.json must contain one JSON object.");
            var properties = root.EnumerateObject().Where(p => p.NameEquals("system")).ToArray();
            if (properties.Length != 1 || properties[0].Value.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException("world.json must contain exactly one top-level string system property.");
            if (properties[0].Value.GetString() != "dark-heresy")
                throw new InvalidOperationException("Refusing world whose system is not dark-heresy (including an already moved world).");

            var reader = new Utf8JsonReader(payload.Span, new JsonReaderOptions { MaxDepth = 128 });
            int start = -1, end = -1;
            while (reader.Read()) {
                if (reader.TokenType != JsonTokenType.PropertyName || reader.CurrentDepth != 1 || !reader.ValueTextEquals("system")) continue;
                if (!reader.Read() || reader.TokenType != JsonTokenType.String)
                    throw new InvalidOperationException("Invalid system value.");
                start = bom + checked((int)reader.TokenStartIndex);
                end = bom + checked((int)reader.BytesConsumed);
                break;
            }
            if (start < 0 || end <= start) throw new InvalidOperationException("Cannot identify the system JSON token.");
            var replacement = Encoding.UTF8.GetBytes("\"apex-heresy-ru\"");
            var updated = new byte[original.Length - (end - start) + replacement.Length];
            Buffer.BlockCopy(original, 0, updated, 0, start);
            Buffer.BlockCopy(replacement, 0, updated, start, replacement.Length);
            Buffer.BlockCopy(original, end, updated, start + replacement.Length, original.Length - end);
            return new ManifestPlan {
                UpdatedBytes = updated,
                WorldId = Display(root, "id"),
                WorldTitle = Display(root, "title"),
                SystemVersion = Display(root, "systemVersion")
            };
        }
    }
}
'@
}

$worldDirectory = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorldPath)
Assert-RegularPath -Path $worldDirectory
if (-not (Get-Item -LiteralPath $worldDirectory -Force).PSIsContainer) {
    throw 'WorldPath must be the selected world directory, not world.json or the Foundry Data directory.'
}
$manifestPath = Join-Path $worldDirectory 'world.json'
Assert-RegularPath -Path $manifestPath
if ((Get-Item -LiteralPath $manifestPath -Force).PSIsContainer) {
    throw 'world.json must be a regular file.'
}
$originalBytes = [IO.File]::ReadAllBytes($manifestPath)
$plan = [ApexWorldTransitionV1.ManifestPlan]::Create($originalBytes)
$originalHash = Get-ByteHash -Bytes $originalBytes

if (-not $Apply) {
    [pscustomobject]@{
        Mode = 'DryRun; no files changed'
        WorldPath = $worldDirectory
        WorldId = $plan.WorldId
        WorldTitle = $plan.WorldTitle
        Change = 'world.json: system dark-heresy -> apex-heresy-ru'
        SystemVersion = $plan.SystemVersion
        ManifestSHA256 = $originalHash
        Requirements = 'Known Apex world; install apex-heresy-ru; full world backup; stop Foundry; use -Apply -ConfirmApexWorld -FoundryStopped'
    }
    return
}
if (-not $ConfirmApexWorld) {
    throw 'Apply requires -ConfirmApexWorld. The legacy id also belongs to Vendare: confirm independently that this is an Apex Heresy world.'
}
if (-not $FoundryStopped) {
    throw 'Apply requires -FoundryStopped. Stop the Foundry server completely; the script cannot verify a remote or local server is offline.'
}

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffffffZ', [Globalization.CultureInfo]::InvariantCulture)
$backupPath = Join-Path $worldDirectory "world.json.before-apex-heresy-ru.$stamp.bak"
$temporaryPath = Join-Path $worldDirectory ("world.json.apex-transition.{0}.tmp" -f [Guid]::NewGuid().ToString('N'))
$temporaryCreated = $false
$backupCreated = $false
try {
    Assert-RegularPath -Path $manifestPath
    if ((Get-ByteHash -Bytes ([IO.File]::ReadAllBytes($manifestPath))) -cne $originalHash) {
        throw 'world.json changed during validation; nothing was written. Stop Foundry and retry.'
    }
    Write-NewFile -Path $backupPath -Bytes $originalBytes
    $backupCreated = $true
    if ((Get-ByteHash -Bytes ([IO.File]::ReadAllBytes($backupPath))) -cne $originalHash) {
        throw 'Backup verification failed; world.json was not changed.'
    }
    # Reserve the temporary file before writing, so cleanup can only delete ours.
    $temporaryStream = [IO.File]::Open($temporaryPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $temporaryCreated = $true
    try {
        $temporaryStream.Write($plan.UpdatedBytes, 0, $plan.UpdatedBytes.Length)
        $temporaryStream.Flush($true)
    }
    finally { $temporaryStream.Dispose() }
    Assert-RegularPath -Path $manifestPath
    if ((Get-ByteHash -Bytes ([IO.File]::ReadAllBytes($manifestPath))) -cne $originalHash) {
        throw 'world.json changed after backup; replacement refused. Stop Foundry and inspect the world before retrying.'
    }
    # Same-directory atomic replacement. No non-atomic fallback is attempted.
    [IO.File]::Replace($temporaryPath, $manifestPath, [System.Management.Automation.Language.NullString]::Value)
    $temporaryCreated = $false
    if ((Get-ByteHash -Bytes ([IO.File]::ReadAllBytes($manifestPath))) -cne (Get-ByteHash -Bytes $plan.UpdatedBytes)) {
        throw 'Post-write verification failed. Keep Foundry stopped and inspect the backup before continuing.'
    }
}
catch {
    if ($backupCreated) { Write-Warning "Manifest backup retained: $backupPath" }
    throw
}
finally {
    if ($temporaryCreated) { [IO.File]::Delete($temporaryPath) }
}

$quotedBackup = "'" + $backupPath.Replace("'", "''") + "'"
$quotedManifest = "'" + $manifestPath.Replace("'", "''") + "'"
[pscustomobject]@{
    Mode = 'Applied; only world.json system value changed'
    WorldPath = $worldDirectory
    WorldId = $plan.WorldId
    WorldTitle = $plan.WorldTitle
    SystemVersion = $plan.SystemVersion
    Backup = $backupPath
    OriginalSHA256 = $originalHash
    UpdatedSHA256 = Get-ByteHash -Bytes $plan.UpdatedBytes
    RollbackBeforeLaunch = "With Foundry stopped: Copy-Item -LiteralPath $quotedBackup -Destination $quotedManifest -Force"
    RollbackAfterLaunch = 'Restore the complete pre-migration world backup; this manifest backup does not roll back runtime database migrations.'
    Next = 'Launch this world with apex-heresy-ru installed. Retain the full world backup until play has been verified.'
}
