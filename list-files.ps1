# SFTP List Files Script
$sftpHost = "access-5018815568.webspace-host.com"
$user = "a1991758"
$password = ",Ux*nY6}5Mn6'fy"
$port = 22

$securePassword = ConvertTo-SecureString $password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($user, $securePassword)

Import-Module Posh-SSH

try {
    Write-Host "Connecting to SFTP server..."
    $session = New-SFTPSession -ComputerName $sftpHost -Credential $credential -Port $port -AcceptKey
    
    Write-Host "`nFiles in root directory:"
    Write-Host "========================"
    Get-SFTPChildItem -SessionId $session.SessionId -Path "/" | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
    
    Write-Host "`nFiles in /js directory:"
    Write-Host "========================"
    Get-SFTPChildItem -SessionId $session.SessionId -Path "/js" -ErrorAction SilentlyContinue | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
    
    Remove-SFTPSession -SessionId $session.SessionId
    Write-Host "`n✅ File listing complete!"
    
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)"
}
