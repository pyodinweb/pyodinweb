# Deployment Scripts Usage

These PowerShell scripts help manage PyOdin Web deployment to both the web server and GitHub repository.

## Scripts Overview

### 🚀 `deploy.ps1` - Master Deployment
The main deployment script that handles both server and GitHub sync.

```powershell
# Full deployment (server + GitHub)
.\deploy.ps1

# Custom commit message
.\deploy.ps1 -CommitMessage "Fix bug in firmware parser"

# Server only
.\deploy.ps1 -ServerOnly

# GitHub only
.\deploy.ps1 -GitHubOnly
```

### 📤 `upload-to-server.ps1` - Web Server Upload
Uploads files to the web server, excluding README and test HTML files.

- ✅ Uploads: index.html, JS files, assets
- ❌ Excludes: README.md, diagnostic.html, test-tar-parsing.html
- 🗑️ Removes excluded files from server if they exist
- 🔧 Sets proper permissions (644 for files, 755 for directories)

### 📚 `sync-to-github.ps1` - GitHub Repository Sync
Commits and pushes all files to the GitHub repository.

- ✅ Includes all files (README, documentation, test files)
- 💾 Auto-commits changes
- 🚀 Pushes to main branch

### 📥 `sync-sftp.ps1` - Download from Server
Downloads files from the web server (useful for backups or pulling changes).

## File Distribution

| File | Web Server | GitHub |
|------|------------|---------|
| index.html | ✅ | ✅ |
| JavaScript files | ✅ | ✅ |
| Assets (JSON, robots.txt, etc.) | ✅ | ✅ |
| README.md | ❌ | ✅ |
| diagnostic.html | ❌ | ✅ |
| test-tar-parsing.html | ❌ | ✅ |
| FIXES.md | ❌ | ✅ |

## Notes

- All PowerShell scripts are excluded from GitHub via .gitignore
- Web server only contains production-ready files
- GitHub repository contains all files including documentation
- Proper file permissions are automatically set on the server