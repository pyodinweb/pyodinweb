# SFTP Upload Script
$sftpHost = "access-5018815568.webspace-host.com"
$user = "a1991758"
$password = ",Ux*nY6}5Mn6'fy"
$port = 22

# Create password as secure string
$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($user, $securePassword)

# Install Posh-SSH if not already installed
if (-not (Get-Module -ListAvailable -Name Posh-SSH)) {
    Write-Host "Installing Posh-SSH module..."
    Install-Module -Name Posh-SSH -Force -Scope CurrentUser
}

Import-Module Posh-SSH

try {
    Write-Host "Connecting to SFTP server..."
    $session = New-SFTPSession -ComputerName $sftpHost -Credential $credential -Port $port -AcceptKey
    
    Write-Host "Connected! Uploading files..."
    
    # Upload root files
    $files = @(
        "index.html",
        "diagnostic.html",
        "FIXES.md",
        "lz4-bundle.js",
        "lz4-wrapper.js",
        "lz4.min.js",
        "manifest.json",
        "package.json",
        "README.md",
        "test-tar-parsing.html",
        "logo.svg",
        "favicon.svg"
    )
    
    foreach ($file in $files) {
        if (Test-Path $file) {
            Write-Host "Uploading $file..."
            Set-SFTPItem -SessionId $session.SessionId -Path $file -Destination "/" -Force
        }
    }
    
    # Create js directory and upload JS files
    Write-Host "Creating /js directory..."
    New-SFTPItem -SessionId $session.SessionId -Path "/js" -ItemType Directory -Force
    
    $jsFiles = Get-ChildItem -Path "js" -File
    foreach ($jsFile in $jsFiles) {
        Write-Host "Uploading js/$($jsFile.Name)..."
        Set-SFTPItem -SessionId $session.SessionId -Path "js\$($jsFile.Name)" -Destination "/js/" -Force
    }
    
    Write-Host "`n✅ All files uploaded successfully!"
    
    # Disconnect
    Remove-SFTPSession -SessionId $session.SessionId
    Write-Host "Disconnected from SFTP server."
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)"
}
