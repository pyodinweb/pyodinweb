/**
 * Main application logic for PyOdin Web
 * Handles UI interactions and coordinates flashing operations
 */

// Global state
let flasher = null;
let currentFirmware = null;
let isFlashing = false;
let selectedFile = null;
let fileDataCache = null;  // Cache file data to avoid re-reading

// Partition files storage (for separate BL/AP/CP/CSC inputs)
let partitionFiles = {
    BL: null,
    AP: null,
    CP: null,
    CSC: null
};

/**
 * Handle individual partition file selection
 */
function handlePartitionSelect(partitionName, event) {
    const files = event.target.files;
    const nameElement = document.getElementById(`file-${partitionName.toLowerCase()}-name`);
    
    if (!files || files.length === 0) {
        partitionFiles[partitionName] = null;
        nameElement.textContent = 'No file selected';
        nameElement.title = '';
        return;
    }
    
    const file = files[0];
    partitionFiles[partitionName] = file;
    
    const displayText = `${file.name} (${formatBytes(file.size)})`;
    nameElement.textContent = displayText;
    nameElement.title = displayText; // Show full name on hover
    nameElement.style.color = 'var(--success-color)';
    
    log(`${partitionName} file selected: ${file.name} (${formatBytes(file.size)})`, 'info');
}

/**
 * Load all selected partition files
 */
async function loadSelectedPartitions() {
    // Collect selected files
    const selectedFiles = [];
    
    for (const [partition, file] of Object.entries(partitionFiles)) {
        if (file) {
            selectedFiles.push(file);
        }
    }
    
    if (selectedFiles.length === 0) {
        showError('No files selected. Please select at least one partition file.');
        return;
    }
    
    log(`\n==== Loading ${selectedFiles.length} partition file(s) ====`, 'info');
    
    const partitionNames = Object.entries(partitionFiles)
        .filter(([_, file]) => file !== null)
        .map(([name, _]) => name)
        .join(', ');
    
    log(`Selected partitions: ${partitionNames}`, 'info');
    
    try {
        // Use the existing multi-file handler
        await handleMultipleFirmwareFiles(selectedFiles);
    } catch (error) {
        log(`Failed to load partitions: ${error.message}`, 'error');
        showError(`Failed to load partitions: ${error.message}`);
    }
}

/**
 * Show disclaimer modal on first visit
 */
function showDisclaimer() {
    const hasAccepted = localStorage.getItem('pyodin-disclaimer-accepted');
    if (!hasAccepted) {
        document.getElementById('disclaimer-modal').style.display = 'flex';
    }
}

/**
 * Accept disclaimer and hide modal
 */
function acceptDisclaimer() {
    localStorage.setItem('pyodin-disclaimer-accepted', 'true');
    document.getElementById('disclaimer-modal').style.display = 'none';
    log('Disclaimer accepted', 'info');
}

/**
 * Copy Bitcoin address to clipboard
 */
function copyBitcoinAddress() {
    const address = '3CSk7Ci4hFuPu24tdtkw5BE92SwRjaVvBs';
    
    navigator.clipboard.writeText(address).then(() => {
        showSuccess('Bitcoin address copied to clipboard!');
        log('Bitcoin address copied: ' + address, 'info');
    }).catch(err => {
        log('Failed to copy address: ' + err, 'error');
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = address;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showSuccess('Bitcoin address copied to clipboard!');
        } catch (err) {
            showError('Failed to copy address. Please copy manually.');
        }
        document.body.removeChild(textArea);
    });
}

/**
 * Initialize application
 */
window.addEventListener('DOMContentLoaded', () => {
    log('PyOdin Web initialized', 'success');
    
    // Show disclaimer on first visit
    showDisclaimer();
    
    // Check WebUSB support
    if (!checkWebUSBSupport()) {
        log('WebUSB not supported. Please use Chrome, Edge, or Opera (version 61+)', 'error');
        return;
    }
    
    log('WebUSB API detected - Device connection available', 'info');
    
    // Check LZ4 library
    if (typeof lz4 !== 'undefined') {
        log('LZ4 library loaded successfully', 'success');
    } else {
        log('LZ4 library not loaded - LZ4 files may not work', 'warning');
    }
    
    // Initialize flasher
    try {
        // Check if required classes are available
        if (typeof OdinFlasher === 'undefined') {
            throw new Error('OdinFlasher class not loaded - check flasher.js');
        }
        if (typeof FirmwareParser === 'undefined') {
            throw new Error('FirmwareParser class not loaded - check firmware-parser.js');
        }
        if (typeof UsbDevice === 'undefined') {
            throw new Error('UsbDevice class not loaded - check usb-device.js');
        }
        
        const verbose = document.getElementById('option-verbose')?.checked || true;
        flasher = new OdinFlasher(verbose);
        log('OdinFlasher initialized successfully', 'success');
    } catch (error) {
        log(`Failed to initialize flasher: ${error.message}`, 'error');
        log(`Error stack: ${error.stack}`, 'error');
        showError(`Failed to initialize application: ${error.message}`);
        return;
    }
    
    log('Ready to flash firmware', 'info');
});

/**
 * Connect to device
 */
async function connectDevice() {
    const btn = document.getElementById('connect-btn');
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('device-status-text');
    const infoText = document.getElementById('device-info-text');
    
    if (!flasher) {
        showError('Flasher not initialized. Refresh the page.');
        return;
    }
    
    try {
        btn.disabled = true;
        btn.innerHTML = 'Connecting...<span class="spinner"></span>';
        
        log('Requesting device access...', 'info');
        
        const deviceInfo = await flasher.connectDevice();
        
        // Update UI
        statusIndicator.classList.add('connected');
        statusText.textContent = 'Device Connected';
        infoText.textContent = `${deviceInfo.product || 'Samsung Device'} - Serial: ${deviceInfo.serialNumber || 'Unknown'}`;
        btn.textContent = 'Connected';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-success');
        
        log('Device connected successfully!', 'success');
        
        // Enable flash button if firmware is loaded
        if (currentFirmware) {
            document.getElementById('flash-btn').disabled = false;
        }
        
    } catch (error) {
        log(`Failed to connect: ${error.message}`, 'error');
        statusText.textContent = 'Connection Failed';
        infoText.textContent = error.message;
        btn.disabled = false;
        btn.textContent = 'Connect Device';
        showError(`Failed to connect to device: ${error.message}`);
    }
}

/**
 * Handle firmware file selection
 * For large files (>4GB), keep file handle and read in chunks
 * Supports multiple files (e.g., BL, AP, CP, CSC)
 */
async function handleFirmwareSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) {
        log('No file selected', 'warning');
        return;
    }
    
    log(`Selected ${files.length} file(s)`, 'info');
    
    try {
        // If single ZIP file, handle specially
        if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) {
    const file = files[0];
            log(`ZIP file detected: ${file.name} (${formatBytes(file.size)})`, 'info');
            await handleZipFile(file);
            return;
        }
        
        // Multiple files - combine them all
        await handleMultipleFirmwareFiles(Array.from(files));
        
    } catch (error) {
        log(`Failed to load firmware: ${error.message}`, 'error');
        showError(`Failed to load firmware: ${error.message}`);
    }
}

/**
 * Handle multiple firmware files (BL, AP, CP, CSC, etc.)
 */
async function handleMultipleFirmwareFiles(files) {
    log(`\n==== Loading ${files.length} firmware file(s) ====`, 'info');
    
    // Combined firmware data
    const combinedFirmware = new FirmwareData();
    const fileInfos = [];
    let totalSize = 0;
    
    // Process each file
    for (const file of files) {
        log(`\nProcessing: ${file.name} (${formatBytes(file.size)})`, 'info');
        totalSize += file.size;
        
        // Check if ZIP
        if (file.name.toLowerCase().endsWith('.zip')) {
            log('Cannot mix ZIP files with TAR files', 'error');
            throw new Error('Cannot select ZIP along with other files. Select either one ZIP or multiple TARs.');
        }
        
        // Parse this TAR file
        const filesFound = await parseSingleTarFile(file, combinedFirmware);
        
        fileInfos.push({
            name: file.name,
            size: file.size,
            filesFound: filesFound
        });
        
        log(`✓ Loaded ${filesFound} files from ${file.name}`, 'success');
    }
    
    log(`\n✓ Total: ${combinedFirmware.items.length} files from ${files.length} TAR(s)`, 'success');
    log(`Total size: ${formatBytes(totalSize)}`, 'info');
    
    // Store as current firmware
    currentFirmware = combinedFirmware;
    selectedFile = files[0]; // For compatibility
    
    // Update UI
    document.getElementById('firmware-info').classList.remove('hidden');
    document.getElementById('firmware-name').textContent = files.map(f => f.name).join(', ');
    document.getElementById('firmware-size').textContent = formatBytes(totalSize);
    document.getElementById('firmware-type').textContent = `${files.length} TAR file(s)`;
    document.getElementById('firmware-md5').textContent = 'N/A (multiple files)';
    
    // Show all items
    if (combinedFirmware.items.length > 0) {
        const itemsContainer = document.getElementById('firmware-items');
        itemsContainer.innerHTML = '';
        
        for (const item of combinedFirmware.items) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'firmware-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'firmware-item-name';
            nameSpan.textContent = item.filename;
            
            if (item.info.isNestedTar) {
                const badge = document.createElement('span');
                badge.style.cssText = 'background: #007bff; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;';
                badge.textContent = 'TAR';
                nameSpan.appendChild(badge);
            }
            
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'firmware-item-size';
            sizeSpan.textContent = formatBytes(item.info.actualSize);
            
            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(sizeSpan);
            itemsContainer.appendChild(itemDiv);
        }
        
        document.getElementById('firmware-items-container').classList.remove('hidden');
    }
    
    if (flasher && flasher.isConnected) {
        document.getElementById('flash-btn').disabled = false;
    }
}

/**
 * Parse a single TAR file and add its items to firmware data
 * Returns number of files found
 */
async function parseSingleTarFile(file, firmwareData) {
    // For .md5 files, check for MD5 hash at end
    let tarEndOffset = file.size;
    let md5Hash = null;
    
    if (file.name.toLowerCase().endsWith('.md5')) {
        const tailSize = Math.min(512, file.size);
        const tailBlob = file.slice(file.size - tailSize, file.size);
        const tailBuffer = await tailBlob.arrayBuffer();
        const tailData = new Uint8Array(tailBuffer);
        const tailStr = new TextDecoder().decode(tailData);
        const md5Match = tailStr.match(/([0-9a-fA-F]{32})\s+/);
        
        if (md5Match) {
            md5Hash = md5Match[1].toLowerCase();
            const md5LineIndex = tailStr.indexOf(md5Match[0]);
            if (md5LineIndex >= 0) {
                tarEndOffset = file.size - (tailSize - md5LineIndex);
            }
            log(`  MD5: ${md5Hash}`, 'info');
        }
    }
    
    // Parse TAR by reading headers only
    let currentOffset = 0;
    let filesFound = 0;
    
    while (currentOffset < tarEndOffset && filesFound < 1000) {
        if (currentOffset + 512 > file.size) break;
        
        // Read just this 512-byte header
        const headerBlob = file.slice(currentOffset, currentOffset + 512);
        const headerBuffer = await headerBlob.arrayBuffer();
        const headerData = new Uint8Array(headerBuffer);
        
        // Check for end of TAR
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (headerData[i] !== 0) {
                allZero = false;
                break;
            }
        }
        if (allZero) break;
        
        // Parse header
        const filename = readString(headerData, 0, 100).trim();
        const sizeStr = readString(headerData, 124, 12).trim();
        const size = parseInt(sizeStr, 8);
        
        if (!filename || isNaN(size) || size < 0) {
            currentOffset += 512;
            continue;
        }
        
        const fileDataOffset = currentOffset + 512;
        const isCompressed = filename.toLowerCase().endsWith('.lz4') || filename.toLowerCase().endsWith('.gz');
        const isNestedTar = filename.toLowerCase().endsWith('.tar') || 
                           filename.toLowerCase().includes('.tar.') ||
                           filename.toLowerCase().match(/\.(ap|bl|cp|csc)$/);
        
        const typeLabel = isNestedTar ? ' [NESTED TAR]' : (isCompressed ? ' [compressed]' : '');
        log(`    ${filename}: ${formatBytes(size)}${typeLabel}`, 'info');
        
        // Create item with NO data - will extract on-demand
        const item = new FirmwareItem(filename, null, {
            size: size,
            compression_type: 'none',
            is_compressed: isCompressed,
            isNestedTar: isNestedTar,
            isLargeFile: true,
            fileHandle: file,
            fileOffset: fileDataOffset,
            actualSize: size,
            tarHeader: headerData
        });
        
        firmwareData.items.push(item);
        filesFound++;
        
        // Move to next header
        const paddedSize = Math.ceil(size / 512) * 512;
        currentOffset += 512 + paddedSize;
    }
    
    return filesFound;
}

/**
 * Original single-file handler (kept for backward compatibility)
 */
async function handleSingleFirmwareFile(file) {
    log(`File selected: ${file.name} (${formatBytes(file.size)})`, 'info');
    
    try {
        // Chrome has ~4GB file read limit - can't load entire 7.5GB file
        // Solution: Parse TAR headers ONLY (512 bytes each), extract files on-demand during flashing
        log('Parsing TAR structure (header-only, no file extraction)...', 'info');
        
        // Store original file handle
    selectedFile = file;
        
        // For .md5 files, check for MD5 hash at end
        let tarEndOffset = file.size;
        let md5Hash = null;
        
        if (file.name.toLowerCase().endsWith('.md5')) {
            const tailSize = Math.min(512, file.size);
            const tailBlob = file.slice(file.size - tailSize, file.size);
            const tailBuffer = await tailBlob.arrayBuffer();
            const tailData = new Uint8Array(tailBuffer);
            const tailStr = new TextDecoder().decode(tailData);
            const md5Match = tailStr.match(/([0-9a-fA-F]{32})\s+/);
            
            if (md5Match) {
                md5Hash = md5Match[1].toLowerCase();
                const md5LineIndex = tailStr.indexOf(md5Match[0]);
                if (md5LineIndex >= 0) {
                    tarEndOffset = file.size - (tailSize - md5LineIndex);
                }
                log(`Found MD5: ${md5Hash}`, 'success');
            }
        }
        
        // Parse TAR by reading headers only
        const firmwareData = new FirmwareData();
        firmwareData.md5Hash = md5Hash;
        
        let currentOffset = 0;
        let filesFound = 0;
        
        while (currentOffset < tarEndOffset && filesFound < 1000) {
            if (currentOffset + 512 > file.size) break;
            
            // Read just this 512-byte header
            const headerBlob = file.slice(currentOffset, currentOffset + 512);
            const headerBuffer = await headerBlob.arrayBuffer();
            const headerData = new Uint8Array(headerBuffer);
            
            // Check for end of TAR
            let allZero = true;
            for (let i = 0; i < 512; i++) {
                if (headerData[i] !== 0) {
                    allZero = false;
                    break;
                }
            }
            if (allZero) break;
            
            // Parse header
            const filename = readString(headerData, 0, 100).trim();
            const sizeStr = readString(headerData, 124, 12).trim();
            const size = parseInt(sizeStr, 8);
            
            if (!filename || isNaN(size) || size < 0) {
                currentOffset += 512;
                continue;
            }
            
            const fileDataOffset = currentOffset + 512;
            const isCompressed = filename.toLowerCase().endsWith('.lz4') || filename.toLowerCase().endsWith('.gz');
            const isNestedTar = filename.toLowerCase().endsWith('.tar') || 
                               filename.toLowerCase().includes('.tar.') ||
                               filename.toLowerCase().match(/\.(ap|bl|cp|csc)$/);
            
            const typeLabel = isNestedTar ? ' [NESTED TAR]' : (isCompressed ? ' [compressed]' : '');
            log(`  ${filename}: ${formatBytes(size)} at offset ${fileDataOffset}${typeLabel}`, 'info');
            
            // Create item with NO data - will extract on-demand
            const item = new FirmwareItem(filename, null, {
                size: size,
                compression_type: 'none',
                is_compressed: isCompressed,
                isNestedTar: isNestedTar,
                isLargeFile: true,
                fileHandle: file,
                fileOffset: fileDataOffset,
                actualSize: size,
                tarHeader: headerData
            });
            
            firmwareData.items.push(item);
            filesFound++;
            
            // Move to next header
            const paddedSize = Math.ceil(size / 512) * 512;
            currentOffset += 512 + paddedSize;
        }
        
        log(`✓ Found ${filesFound} files (on-demand extraction mode)`, 'success');
        
        // Check for nested TARs
        const nestedTars = firmwareData.items.filter(item => item.info.isNestedTar);
        if (nestedTars.length > 0) {
            log(`Found ${nestedTars.length} nested TAR(s):`, 'info');
            for (const tar of nestedTars) {
                log(`  - ${tar.filename} (${formatBytes(tar.info.actualSize)})`, 'info');
            }
            log(`You can expand these TARs to flash their contents individually`, 'info');
        }
        
        currentFirmware = firmwareData;
        
        // Show UI
        document.getElementById('firmware-info').classList.remove('hidden');
        document.getElementById('firmware-name').textContent = file.name;
        document.getElementById('firmware-size').textContent = formatBytes(file.size);
        document.getElementById('firmware-type').textContent = 'TAR (on-demand)';
        document.getElementById('firmware-md5').textContent = md5Hash || 'N/A';
        
        if (firmwareData.items.length > 0) {
            const itemsContainer = document.getElementById('firmware-items');
            itemsContainer.innerHTML = '';
            
            for (const item of firmwareData.items) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'firmware-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'firmware-item-name';
                nameSpan.textContent = item.filename;
                
                // Add badge for nested TARs
                if (item.info.isNestedTar) {
                    const badge = document.createElement('span');
                    badge.style.cssText = 'background: #007bff; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;';
                    badge.textContent = 'TAR';
                    nameSpan.appendChild(badge);
                    
                    // Make it clickable to expand
                    itemDiv.style.cursor = 'pointer';
                    itemDiv.title = 'Click to expand this TAR';
                    itemDiv.onclick = () => expandNestedTar(file, item);
                }
                
                const sizeSpan = document.createElement('span');
                sizeSpan.className = 'firmware-item-size';
                sizeSpan.textContent = formatBytes(item.info.actualSize);
                
                itemDiv.appendChild(nameSpan);
                itemDiv.appendChild(sizeSpan);
                itemsContainer.appendChild(itemDiv);
            }
            
            document.getElementById('firmware-items-container').classList.remove('hidden');
        }
        
        if (flasher && flasher.isConnected) {
            document.getElementById('flash-btn').disabled = false;
        }
        
    } catch (error) {
        log(`Failed to load firmware: ${error.message}`, 'error');
        showError(`Failed to load firmware: ${error.message}`);
    }
}

/**
 * Handle ZIP file containing .tar.md5 files
 */
async function handleZipFile(zipFile) {
    log('ZIP file detected, parsing contents...', 'info');
    log(`ZIP file: ${zipFile.name}, size: ${formatBytes(zipFile.size)}, type: ${zipFile.type}`, 'info');
    
    try {
        if (typeof ZipParser === 'undefined') {
            throw new Error('ZipParser not loaded - check if js/zip-parser.js loaded correctly');
        }
        
        log('Creating ZipParser instance...', 'info');
        const zipParser = new ZipParser(true);
        
        log('Calling parseZip()...', 'info');
        const entries = await zipParser.parseZip(zipFile);
        
        log(`parseZip() returned ${entries ? entries.length : 'null/undefined'} entries`, 'info');
        
        if (!entries) {
            throw new Error('parseZip() returned null or undefined');
        }
        
        log(`Found ${entries.length} total entries in ZIP`, 'info');
        
        // Filter for TAR files (AP, BL, CP, CSC, etc.)
        const tarFiles = entries.filter(e => e.isTar);
        
        log(`Detected ${tarFiles.length} TAR file(s)`, 'info');
        
        // If no TARs detected, show ALL entries so user can see what's there
        if (tarFiles.length === 0) {
            log('No TAR files auto-detected. Showing all entries:', 'warning');
            for (const entry of entries) {
                log(`  - ${entry.filename} (${formatBytes(entry.uncompressedSize)}) [${entry.type}]`, 'info');
            }
            
            // Still allow user to try loading any entry
            // Use all entries instead of just TARs
            tarFiles.push(...entries);
        }
        
        if (tarFiles.length === 0) {
            showError('ZIP file is empty or contains no valid files');
            return;
        }
        
        log(`Showing ${tarFiles.length} file(s) for selection`, 'success');
        
        // Show selection UI
        const itemsContainer = document.getElementById('firmware-items');
        itemsContainer.innerHTML = '<h3 style="margin-bottom: 10px;">Select TAR to flash:</h3>';
        
        for (const tar of tarFiles) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'firmware-item';
            itemDiv.style.cursor = 'pointer';
            itemDiv.style.border = '2px solid #007bff';
            itemDiv.title = `Click to load ${tar.filename}`;
            
            itemDiv.onclick = async () => {
                log(`Loading ${tar.filename} from ZIP...`, 'info');
                
                // Disable other items while loading
                const allItems = itemsContainer.querySelectorAll('.firmware-item');
                allItems.forEach(item => item.style.pointerEvents = 'none');
                itemDiv.style.opacity = '0.5';
                
                try {
                    await loadTarFromZip(zipFile, tar);
                } catch (error) {
                    // Re-enable on error
                    allItems.forEach(item => item.style.pointerEvents = '');
                    itemDiv.style.opacity = '1';
                    throw error;
                }
            };
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'firmware-item-name';
            nameSpan.textContent = tar.filename;
            
            const typeBadge = document.createElement('span');
            typeBadge.style.cssText = 'background: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;';
            typeBadge.textContent = tar.type.toUpperCase();
            nameSpan.appendChild(typeBadge);
            
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'firmware-item-size';
            sizeSpan.textContent = formatBytes(tar.uncompressedSize);
            
            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(sizeSpan);
            itemsContainer.appendChild(itemDiv);
        }
        
        document.getElementById('firmware-info').classList.remove('hidden');
        document.getElementById('firmware-name').textContent = zipFile.name;
        document.getElementById('firmware-size').textContent = formatBytes(zipFile.size);
        document.getElementById('firmware-type').textContent = `ZIP (${tarFiles.length} TARs)`;
        document.getElementById('firmware-md5').textContent = 'Select TAR to view';
        document.getElementById('firmware-items-container').classList.remove('hidden');
        
    } catch (error) {
        log(`Failed to parse ZIP: ${error.message}`, 'error');
        log(`Error stack: ${error.stack}`, 'error');
        showError(`Failed to parse ZIP: ${error.message}\n\nCheck console for details.`);
    }
}

/**
 * Load a TAR file from within a ZIP
 */
async function loadTarFromZip(zipFile, zipEntry) {
    log(`Loading ${zipEntry.filename} from ZIP...`, 'info');
    
    try {
        const zipParser = new ZipParser(true);
        const extracted = await zipParser.extractFile(zipFile, zipEntry);
        
        log(`Extraction info:`, 'info');
        log(`  isZipCompressed: ${extracted.isZipCompressed}`, 'info');
        log(`  Offset: ${extracted.offset}`, 'info');
        log(`  Size: ${formatBytes(extracted.size)}`, 'info');
        log(`  Uncompressed: ${formatBytes(extracted.uncompressedSize)}`, 'info');
        
        if (extracted.isZipCompressed) {
            // TAR is DEFLATE-compressed inside ZIP
            // We need to decompress it to read TAR headers
            log(`TAR is compressed in ZIP - decompressing to read headers...`, 'info');
            await parseTarFromCompressedZip(zipFile, extracted);
        } else {
            // TAR is stored uncompressed - can read directly
            log(`TAR is uncompressed in ZIP - reading directly...`, 'success');
            await parseTarFromOffset(zipFile, extracted.offset, extracted.uncompressedSize, extracted.filename);
        }
        
    } catch (error) {
        log(`Failed to load TAR from ZIP: ${error.message}`, 'error');
        showError(`Failed to load TAR from ZIP: ${error.message}`);
    }
}

/**
 * Parse TAR that's DEFLATE-compressed inside a ZIP
 * Uses streaming decompression to read headers without loading entire file
 */
async function parseTarFromCompressedZip(zipFile, zipInfo) {
    log(`Extracting TAR headers from compressed ZIP: ${zipInfo.filename}`, 'info');
    log(`  Compressed: ${formatBytes(zipInfo.size)}, Uncompressed: ${formatBytes(zipInfo.uncompressedSize)}`, 'info');
    
    if (typeof pako === 'undefined') {
        throw new Error('pako library required for ZIP decompression');
    }
    
    // Decompress incrementally and extract headers as we go
    const READ_CHUNK_SIZE = 64 * 1024 * 1024; // 64MB at a time
    
    const firmwareData = new FirmwareData();
    let compressedOffset = 0;
    let tarOffset = 0;
    let pendingData = new Uint8Array(0); // Small buffer for incomplete headers
    let bytesToSkip = 0; // Track file data we need to skip in future chunks
    
    // Use pako with chunk callback to avoid accumulating all output
    let decompError = null;
    const inflator = new pako.Inflate({ 
        raw: true,
        chunkSize: 1024 * 1024 // 1MB decompressed chunks
        // Don't set 'to' - onData callback will handle output
    });
    
    // Override to get decompressed chunks without accumulation
    inflator.onData = function(chunk) {
        // chunk is Uint8Array of decompressed data
        // Process it immediately and discard
        
        if (pendingData.length === 0 && firmwareData.items.length === 0) {
            log(`  First decompressed chunk: ${formatBytes(chunk.length)}, first 64 bytes: ${bytesToHex(chunk.slice(0, 64))}`, 'info');
        }
        
        // Combine with pending data
        const combined = new Uint8Array(pendingData.length + chunk.length);
        combined.set(pendingData, 0);
        combined.set(chunk, pendingData.length);
        
        let bufferOffset = 0;
        
        // First, skip any bytes we needed to skip from previous chunks
        if (bytesToSkip > 0) {
            const skipNow = Math.min(bytesToSkip, combined.length);
            bufferOffset += skipNow;
            tarOffset += skipNow;
            bytesToSkip -= skipNow;
            
            if (bytesToSkip > 0) {
                // Still need to skip more - entire chunk consumed
                pendingData = new Uint8Array(0);
                return;
            }
        }
        
        // Parse TAR headers from this buffer
        while (bufferOffset + 512 <= combined.length) {
            const header = combined.slice(bufferOffset, bufferOffset + 512);
            
            // Check for end
            let allZero = true;
            for (let i = 0; i < 512; i++) {
                if (header[i] !== 0) {
                    allZero = false;
                    break;
                }
            }
            if (allZero) {
                log(`  Reached end of TAR`, 'info');
                return; // Stop processing
            }
            
            // Parse header
            const filename = readString(header, 0, 100).trim();
            const sizeStr = readString(header, 124, 12).trim();
            const size = parseInt(sizeStr, 8);
            
            if (!filename || isNaN(size) || size < 0) {
                log(`  Invalid header at bufferOffset ${bufferOffset}, skipping 512 bytes`, 'warning');
                bufferOffset += 512;
                tarOffset += 512;
                continue;
            }
            
            log(`  ${filename}: ${formatBytes(size)}`, 'info');
            
            // Create firmware item
            const item = new FirmwareItem(filename, null, {
                size: size,
                compression_type: 'none',
                is_compressed: filename.toLowerCase().endsWith('.lz4') || filename.toLowerCase().endsWith('.gz'),
                fromCompressedZip: true,
                zipFileHandle: zipFile,
                zipOffset: zipInfo.offset,
                zipCompressedSize: zipInfo.size,
                zipUncompressedSize: zipInfo.uncompressedSize,
                tarOffsetInDecompressed: tarOffset + 512,
                actualSize: size,
                tarHeader: new Uint8Array(header) // Copy it
            });
            
            firmwareData.items.push(item);
            
            // Skip past this file's data
            bufferOffset += 512; // Skip header
            tarOffset += 512;
            
            const paddedSize = Math.ceil(size / 512) * 512;
            
            // Check if we have enough data in buffer to skip the file data
            if (bufferOffset + paddedSize <= combined.length) {
                // We have all the file data - skip it
                bufferOffset += paddedSize;
                tarOffset += paddedSize;
            } else {
                // File data extends beyond current buffer
                const dataInBuffer = combined.length - bufferOffset;
                bufferOffset += dataInBuffer;
                tarOffset += dataInBuffer;
                
                // Remember to skip the rest in next chunk
                bytesToSkip = paddedSize - dataInBuffer;
                
                log(`  File ${filename} spans chunks, need to skip ${formatBytes(bytesToSkip)} more`, 'info');
                break; // Stop parsing, wait for next chunk
            }
        }
        
        // Keep any remaining data for next chunk
        if (bufferOffset < combined.length) {
            pendingData = combined.slice(bufferOffset);
        } else {
            pendingData = new Uint8Array(0);
        }
    };
    
    inflator.onEnd = function(status) {
        if (status !== 0) {
            decompError = new Error(`Decompression failed with status ${status}`);
        }
    };
    
    log(`Streaming decompression with onData callback (memory efficient)...`, 'info');
    
    while (compressedOffset < zipInfo.size) {
        const chunkEnd = Math.min(compressedOffset + READ_CHUNK_SIZE, zipInfo.size);
        const isLast = chunkEnd >= zipInfo.size;
        
        // Read compressed chunk
        const chunkBlob = zipFile.slice(zipInfo.offset + compressedOffset, zipInfo.offset + chunkEnd);
        const chunkBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Chunk read failed'));
            reader.readAsArrayBuffer(chunkBlob);
        });
        const chunkData = new Uint8Array(chunkBuffer);
        
        if (compressedOffset === 0) {
            log(`  First 32 bytes of data at offset: ${bytesToHex(chunkData.slice(0, 32))}`, 'info');
            
            // Check if this might actually be uncompressed TAR data
            let possiblyTar = true;
            for (let i = 0; i < Math.min(100, chunkData.length); i++) {
                const byte = chunkData[i];
                // TAR filenames should be printable ASCII or null
                if (byte !== 0 && (byte < 32 || byte > 126)) {
                    possiblyTar = false;
                    break;
                }
            }
            
            if (possiblyTar) {
                const possibleFilename = readString(chunkData, 0, 100).trim();
                log(`  WARNING: Data looks like uncompressed TAR! Possible filename: "${possibleFilename}"`, 'warning');
                log(`  The ZIP might be using STORED mode, not DEFLATE`, 'warning');
            }
        }
        
        // Push to inflator - onData callback will process output
        inflator.push(chunkData, isLast);
        
        if (inflator.err || decompError) {
            const msg = inflator.msg || (decompError ? decompError.message : 'Unknown');
            log(`  DEFLATE error: ${msg}`, 'error');
            throw new Error(`DEFLATE decompression error: ${msg}`);
        }
        
        compressedOffset += chunkData.length;
        
        const percent = (compressedOffset / zipInfo.size) * 100;
        log(`  ${percent.toFixed(0)}% read (${firmwareData.items.length} files found)`, 'info');
    }
    
    log(`✓ Extracted ${firmwareData.items.length} file headers from compressed TAR`, 'success');
    
    currentFirmware = firmwareData;
    
    // Show UI
    document.getElementById('firmware-info').classList.remove('hidden');
    document.getElementById('firmware-name').textContent = zipInfo.filename;
    document.getElementById('firmware-size').textContent = formatBytes(zipInfo.uncompressedSize);
    document.getElementById('firmware-type').textContent = 'TAR from ZIP (compressed)';
    document.getElementById('firmware-md5').textContent = 'From compressed ZIP';
    
    if (firmwareData.items.length > 0) {
        const itemsContainer = document.getElementById('firmware-items');
        itemsContainer.innerHTML = '';
        
        for (const item of firmwareData.items) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'firmware-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'firmware-item-name';
            nameSpan.textContent = item.filename;
            
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'firmware-item-size';
            sizeSpan.textContent = formatBytes(item.info.actualSize);
            
            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(sizeSpan);
            itemsContainer.appendChild(itemDiv);
        }
        
        document.getElementById('firmware-items-container').classList.remove('hidden');
    }
    
    if (flasher && flasher.isConnected) {
        document.getElementById('flash-btn').disabled = false;
    }
    
    log(`Ready to flash files from compressed ZIP TAR`, 'success');
}

/**
 * Parse TAR from a specific offset in a file (for ZIP extraction)
 */
async function parseTarFromOffset(containerFile, startOffset, tarSize, tarName) {
    log(`Parsing TAR from offset ${startOffset}, size ${formatBytes(tarSize)}...`, 'info');
    log(`Container file: ${containerFile.name}, total size: ${formatBytes(containerFile.size)}`, 'info');
    log(`TAR range: bytes ${startOffset} to ${startOffset + tarSize}`, 'info');
    
    // Store original file handle
    selectedFile = containerFile;
    
    // For .md5 files, check for MD5 hash at end
    let tarEndOffset = startOffset + tarSize;
    let md5Hash = null;
    
    if (tarName.toLowerCase().endsWith('.md5')) {
        log('TAR has .md5 extension, checking for MD5 hash at end...', 'info');
        const tailSize = Math.min(512, tarSize);
        const tailBlob = containerFile.slice(tarEndOffset - tailSize, tarEndOffset);
        
        const tailBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read TAR tail'));
            reader.readAsArrayBuffer(tailBlob);
        });
        
        const tailData = new Uint8Array(tailBuffer);
        const tailStr = new TextDecoder().decode(tailData);
        const md5Match = tailStr.match(/([0-9a-fA-F]{32})\s+/);
        
        if (md5Match) {
            md5Hash = md5Match[1].toLowerCase();
            const md5LineIndex = tailStr.indexOf(md5Match[0]);
            if (md5LineIndex >= 0) {
                tarEndOffset = startOffset + tarSize - (tailSize - md5LineIndex);
            }
            log(`Found MD5: ${md5Hash}`, 'success');
        } else {
            log(`No MD5 found in tail`, 'warning');
        }
    }
    
    // Parse TAR by reading headers only
    const firmwareData = new FirmwareData();
    firmwareData.md5Hash = md5Hash;
    
    let currentOffset = startOffset;
    let filesFound = 0;
    
    while (currentOffset < tarEndOffset && filesFound < 1000) {
        if (currentOffset + 512 > startOffset + tarSize) break;
        
        // Read just this 512-byte header
        log(`Reading header at offset ${currentOffset}...`, 'info');
        const headerBlob = containerFile.slice(currentOffset, currentOffset + 512);
        const headerBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error(`Failed to read header at ${currentOffset}`));
            reader.readAsArrayBuffer(headerBlob);
        });
        const headerData = new Uint8Array(headerBuffer);
        
        log(`Header read, first 16 bytes: ${bytesToHex(headerData.slice(0, 16))}`, 'info');
        
        // Check for end of TAR
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (headerData[i] !== 0) {
                allZero = false;
                break;
            }
        }
        if (allZero) break;
        
        // Parse header
        const filename = readString(headerData, 0, 100).trim();
        const sizeStr = readString(headerData, 124, 12).trim();
        const size = parseInt(sizeStr, 8);
        
        if (!filename || isNaN(size) || size < 0) {
            currentOffset += 512;
            continue;
        }
        
        const fileDataOffset = currentOffset + 512;
        const isCompressed = filename.toLowerCase().endsWith('.lz4') || filename.toLowerCase().endsWith('.gz');
        
        log(`  ${filename}: ${formatBytes(size)} at offset ${fileDataOffset}${isCompressed ? ' [compressed]' : ''}`, 'info');
        
        // Create item with NO data - will extract on-demand
        const item = new FirmwareItem(filename, null, {
            size: size,
            compression_type: 'none',
            is_compressed: isCompressed,
            isLargeFile: true,
            fileHandle: containerFile,
            fileOffset: fileDataOffset,
            actualSize: size,
            tarHeader: headerData
        });
        
        firmwareData.items.push(item);
        filesFound++;
        
        // Move to next header
        const paddedSize = Math.ceil(size / 512) * 512;
        currentOffset += 512 + paddedSize;
    }
    
    log(`✓ Found ${filesFound} files in ${tarName}`, 'success');
    
    currentFirmware = firmwareData;
    
    // Update UI
    document.getElementById('firmware-info').classList.remove('hidden');
    document.getElementById('firmware-name').textContent = tarName;
    document.getElementById('firmware-size').textContent = formatBytes(tarSize);
    document.getElementById('firmware-type').textContent = 'TAR from ZIP (on-demand)';
    document.getElementById('firmware-md5').textContent = md5Hash || 'N/A';
    
    if (firmwareData.items.length > 0) {
        const itemsContainer = document.getElementById('firmware-items');
        itemsContainer.innerHTML = '';
        
        for (const item of firmwareData.items) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'firmware-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'firmware-item-name';
            nameSpan.textContent = item.filename;
            
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'firmware-item-size';
            sizeSpan.textContent = formatBytes(item.info.actualSize);
            
            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(sizeSpan);
            itemsContainer.appendChild(itemDiv);
        }
        
        document.getElementById('firmware-items-container').classList.remove('hidden');
    }
    
    if (flasher && flasher.isConnected) {
        document.getElementById('flash-btn').disabled = false;
    }
}

/**
 * Expand a nested TAR and replace firmware items with its contents
 */
async function expandNestedTar(outerTar, tarItem) {
    log(`Expanding nested TAR: ${tarItem.filename}...`, 'info');
    
    try {
        const nestedParser = new NestedTarParser(true);
        
        // Parse the nested TAR (reads headers only, no data extraction)
        const nestedFiles = await nestedParser.parseNestedTar(outerTar, {
            filename: tarItem.filename,
            size: tarItem.info.actualSize,
            offset: tarItem.info.fileOffset
        });
        
        if (nestedFiles.length === 0) {
            showError('No files found in nested TAR');
            return;
        }
        
        log(`Found ${nestedFiles.length} files in ${tarItem.filename}`, 'success');
        
        // Create new firmware data with nested TAR contents
        const newFirmwareData = new FirmwareData();
        newFirmwareData.md5Hash = currentFirmware.md5Hash;
        
        for (const nestedFile of nestedFiles) {
            const item = new FirmwareItem(nestedFile.filename, null, {
                size: nestedFile.size,
                compression_type: 'none',
                is_compressed: nestedFile.isCompressed,
                isLargeFile: true,
                fileHandle: outerTar,
                fileOffset: nestedFile.offset,
                actualSize: nestedFile.size,
                parentTar: nestedFile.parentTar
            });
            
            newFirmwareData.items.push(item);
        }
        
        currentFirmware = newFirmwareData;
        
        // Update UI
        const itemsContainer = document.getElementById('firmware-items');
        itemsContainer.innerHTML = '';
        
        for (const item of newFirmwareData.items) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'firmware-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'firmware-item-name';
            nameSpan.textContent = item.filename;
            
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'firmware-item-size';
            sizeSpan.textContent = formatBytes(item.info.actualSize);
            
            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(sizeSpan);
            itemsContainer.appendChild(itemDiv);
        }
        
        document.getElementById('firmware-type').textContent = `From: ${tarItem.filename}`;
        
        log(`Now ready to flash contents of ${tarItem.filename}`, 'success');
        
    } catch (error) {
        log(`Failed to expand nested TAR: ${error.message}`, 'error');
        showError(`Failed to expand nested TAR: ${error.message}`);
    }
}

/**
 * Parse firmware from memory (Uint8Array)
 * This avoids browser file permission issues
 */
async function parseFirmwareFromMemory(filename, data) {
    log('Parsing firmware from memory...', 'info');
    
    const firmwareData = new FirmwareData();
    
    // Show loading UI
    document.getElementById('firmware-info').classList.remove('hidden');
    document.getElementById('firmware-name').textContent = filename;
    document.getElementById('firmware-size').textContent = formatBytes(data.length);
    document.getElementById('firmware-type').textContent = detectFileType(filename);
    document.getElementById('firmware-md5').textContent = 'Parsing...';
    
    let tarData = data;
    let tarStartOffset = 0;
    let tarEndOffset = data.length;
    
    // For .md5 files, extract MD5 hash from end
    if (filename.toLowerCase().endsWith('.md5')) {
        const tailSize = Math.min(512, data.length);
        const tailData = data.slice(data.length - tailSize);
        const tailStr = new TextDecoder().decode(tailData);
        const md5Match = tailStr.match(/([0-9a-fA-F]{32})\s+/);
        
        if (md5Match) {
            firmwareData.md5Hash = md5Match[1].toLowerCase();
            document.getElementById('firmware-md5').textContent = firmwareData.md5Hash;
            log(`Found MD5: ${firmwareData.md5Hash}`, 'success');
            
            const md5LineIndex = tailStr.indexOf(md5Match[0]);
            if (md5LineIndex >= 0) {
                tarEndOffset = data.length - (tailSize - md5LineIndex);
                log(`TAR ends at offset: ${tarEndOffset}`, 'info');
            }
        }
    }
    
    // Parse TAR from memory
    log('Parsing TAR structure from memory...', 'info');
    let currentOffset = tarStartOffset;
    let filesFound = 0;
    
    while (currentOffset < tarEndOffset && filesFound < 1000) {
        if (currentOffset + 512 > data.length) break;
        
        const header = data.slice(currentOffset, currentOffset + 512);
        
        // Check for end (empty header)
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) {
                allZero = false;
                break;
            }
        }
        if (allZero) break;
        
        const filename = readString(header, 0, 100).trim();
        const sizeStr = readString(header, 124, 12).trim();
        const size = parseInt(sizeStr, 8);
        
        if (!filename || isNaN(size) || size < 0) {
            currentOffset += 512;
            continue;
        }
        
        filesFound++;
        const fileDataOffset = currentOffset + 512;
        const paddedSize = Math.ceil(size / 512) * 512;
        
        // Extract file data from memory
        const fileData = data.slice(fileDataOffset, fileDataOffset + size);
        const isCompressed = filename.toLowerCase().endsWith('.lz4') || filename.toLowerCase().endsWith('.gz');
        
        log(`Found: ${filename} (${formatBytes(size)})`, 'info');
        
        const item = new FirmwareItem(filename, fileData, {
            size: size,
            compression_type: 'none',
            is_compressed: isCompressed,
            isLargeFile: false,  // All data is now in memory
            fileHandle: null,
            fileOffset: fileDataOffset,
            actualSize: size,
            tarHeader: header
        });
        
        firmwareData.items.push(item);
        
        currentOffset += 512 + paddedSize;
    }
    
    log(`TAR parsing complete: found ${filesFound} files`, 'success');
    currentFirmware = firmwareData;
    
    // Show firmware items in UI
    if (firmwareData.items.length > 0) {
        const itemsContainer = document.getElementById('firmware-items');
        itemsContainer.innerHTML = '';
        
        for (const item of firmwareData.items) {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'firmware-item';
            
            const nameSpan = document.createElement('span');
            nameSpan.className = 'firmware-item-name';
            nameSpan.textContent = item.filename;
            
            const sizeSpan = document.createElement('span');
            sizeSpan.className = 'firmware-item-size';
            sizeSpan.textContent = formatBytes(item.data.length);
            if (item.filename.toLowerCase().includes('.lz4')) {
                sizeSpan.textContent += ' (LZ4 compressed)';
            } else if (item.filename.toLowerCase().includes('.gz')) {
                sizeSpan.textContent += ' (GZIP compressed)';
            }
            
            itemDiv.appendChild(nameSpan);
            itemDiv.appendChild(sizeSpan);
            itemsContainer.appendChild(itemDiv);
        }
        
        document.getElementById('firmware-items-container').classList.remove('hidden');
    }
    
    log(`Firmware ready: ${firmwareData.items.length} files`, 'success');
    
    // Enable flash button if device is connected
    if (flasher && flasher.isConnected) {
        document.getElementById('flash-btn').disabled = false;
    }
}

/**
 * Load and parse firmware from cached data
 */
async function loadFirmwareFromCache() {
    if (!fileDataCache) {
        showError('No file data cached');
        return;
    }
    
    log(`Loading firmware: ${fileDataCache.name} (${formatBytes(fileDataCache.size)})`, 'info');
    
    try {
        // Show loading
        document.getElementById('firmware-info').classList.remove('hidden');
        document.getElementById('firmware-name').textContent = fileDataCache.name;
        document.getElementById('firmware-size').textContent = formatBytes(fileDataCache.size);
        document.getElementById('firmware-type').textContent = detectFileType(fileDataCache.name);
        document.getElementById('firmware-md5').textContent = 'Parsing...';
        
        // Parse firmware using cached data
        log('Parsing firmware from cached data...', 'info');
        const firmwareData = await parseFirmwareFromData(fileDataCache);
        currentFirmware = firmwareData;
        
        // Update MD5 if available
        if (firmwareData.md5Hash) {
            document.getElementById('firmware-md5').textContent = firmwareData.md5Hash;
        } else {
            document.getElementById('firmware-md5').textContent = 'N/A';
        }
        
        // Show firmware items
        if (firmwareData.items.length > 0) {
            const itemsContainer = document.getElementById('firmware-items');
            itemsContainer.innerHTML = '';
            
            for (const item of firmwareData.items) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'firmware-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'firmware-item-name';
                nameSpan.textContent = item.filename;
                
                const sizeSpan = document.createElement('span');
                sizeSpan.className = 'firmware-item-size';
                sizeSpan.textContent = formatBytes(item.data?.length || 0);
                if (item.info.is_compressed) {
                    sizeSpan.textContent += ` (${item.info.compression_type})`;
                }
                
                itemDiv.appendChild(nameSpan);
                itemDiv.appendChild(sizeSpan);
                itemsContainer.appendChild(itemDiv);
            }
            
            document.getElementById('firmware-items-container').classList.remove('hidden');
        }
        
        log(`Firmware loaded: ${firmwareData.items.length} files`, 'success');
        
        // Enable flash button if device is connected
        if (flasher.isConnected) {
            document.getElementById('flash-btn').disabled = false;
        }
        
    } catch (error) {
        log(`Failed to load firmware: ${error.message}`, 'error');
        showError(`Failed to load firmware: ${error.message}`);
    }
}

/**
 * Parse firmware directly from cached data
 */
async function parseFirmwareFromData(fileData) {
    const parser = new FirmwareParser(true);
    
    // Create a mock file object with the cached data
    const mockFile = {
        name: fileData.name,
        size: fileData.size,
        type: fileData.type,
        data: fileData.data
    };
    
    const firmwareData = new FirmwareData();
    
    // Detect file type
    const fileType = detectFileType(mockFile.name, mockFile.data);
    log(`Detected file type: ${fileType}`, 'info');
    
    // Parse based on type
    if (mockFile.name.toLowerCase().endsWith('.md5')) {
        // Extract MD5 and TAR data
        let offset = 0;
        while (offset < mockFile.data.length && mockFile.data[offset] !== 0x0A) {
            offset++;
        }
        offset++;
        
        const md5Line = new TextDecoder().decode(mockFile.data.slice(0, offset));
        const md5Match = md5Line.match(/([a-fA-F0-9]{32})/);
        firmwareData.md5Hash = md5Match ? md5Match[1].toLowerCase() : null;
        
        const tarData = mockFile.data.slice(offset);
        await parseTARData(tarData, firmwareData);
        
    } else if (fileType === 'tar') {
        await parseTARData(mockFile.data, firmwareData);
    } else {
        // Single file
        const item = new FirmwareItem(mockFile.name, mockFile.data, {
            size: mockFile.data.length,
            compression_type: 'none',
            is_compressed: false
        });
        firmwareData.items.push(item);
    }
    
    return firmwareData;
}

/**
 * Parse TAR data
 */
async function parseTARData(data, firmwareData) {
    let offset = 0;
    
    while (offset < data.length) {
        if (offset + 512 > data.length) break;
        
        const header = data.slice(offset, offset + 512);
        
        // Check for end
        let allZero = true;
        for (let i = 0; i < 512; i++) {
            if (header[i] !== 0) {
                allZero = false;
                break;
            }
        }
        if (allZero) break;
        
        // Parse header
        const filename = readString(header, 0, 100).trim();
        const sizeStr = readString(header, 124, 12).trim();
        const size = parseInt(sizeStr, 8);
        
        if (!filename || isNaN(size)) {
            offset += 512;
            continue;
        }
        
        log(`Found: ${filename} (${formatBytes(size)})`, 'info');
        
        offset += 512;
        const fileData = data.slice(offset, offset + size);
        
        const compressionType = detectCompressionType(fileData);
        const item = new FirmwareItem(filename, fileData, {
            size: size,
            compression_type: compressionType,
            is_compressed: compressionType !== 'none'
        });
        
        if (filename.toLowerCase().endsWith('.pit')) {
            firmwareData.pitData = fileData;
        }
        
        firmwareData.items.push(item);
        
        const paddedSize = Math.ceil(size / 512) * 512;
        offset += paddedSize;
    }
}

/**
 * Parse firmware file with streaming support
 * Reads TAR headers to index files, keeps file handle for streaming actual data
 */
async function parseFirmwareWithStreaming(file) {
    log('Parsing large firmware file...', 'info');
    
    try {
        // Show loading
        document.getElementById('firmware-info').classList.remove('hidden');
        document.getElementById('firmware-name').textContent = file.name;
        document.getElementById('firmware-size').textContent = formatBytes(file.size);
        document.getElementById('firmware-type').textContent = detectFileType(file.name);
        document.getElementById('firmware-md5').textContent = 'N/A (large file)';
        
        // For .md5 files, TAR starts at beginning, MD5 is at the END
        let tarStartOffset = 0;
        let tarEndOffset = file.size;
        const firmwareData = new FirmwareData();
        
        // For .md5 files, read MD5 hash from LAST 512 bytes (Samsung format)
        if (file.name.toLowerCase().endsWith('.md5')) {
            log('Reading MD5 hash from end of file...', 'info');
            
            const tailChunk = file.slice(Math.max(0, file.size - 512), file.size);
            const tailData = new Uint8Array(await tailChunk.arrayBuffer());
            
            // Look for MD5 pattern in tail
            const tailStr = new TextDecoder().decode(tailData);
            const md5Match = tailStr.match(/([0-9a-fA-F]{32})\s+/);
            
            if (md5Match) {
                firmwareData.md5Hash = md5Match[1].toLowerCase();
                document.getElementById('firmware-md5').textContent = firmwareData.md5Hash;
                log(`Found MD5 hash: ${firmwareData.md5Hash}`, 'success');
                
                // Find where MD5 line starts in the tail
                const md5LineIndex = tailStr.indexOf(md5Match[0]);
                if (md5LineIndex >= 0) {
                    // TAR ends before the MD5 line
                    tarEndOffset = file.size - (512 - md5LineIndex);
                    log(`TAR ends at offset: ${tarEndOffset}`, 'info');
                }
            } else {
                log('No MD5 hash found in file tail', 'warning');
                document.getElementById('firmware-md5').textContent = 'Not found';
            }
            
            // TAR starts at beginning (offset 0)
            tarStartOffset = 0;
        }
        
        // Parse TAR structure - browser file access is tricky with large files
        log('Parsing TAR structure (streaming mode)...', 'info');
        log(`TAR range: ${tarStartOffset} to ${tarEndOffset} (${formatBytes(tarEndOffset - tarStartOffset)})`, 'info');
        
        // STEP 1: Read header-only region to map the TAR structure (assume ~1MB per file entry)
        // This lets us create ALL blob slices synchronously afterward
        const maxFiles = 1000;
        const estimatedHeaderRegionSize = Math.min(maxFiles * 1024 * 1024, file.size);  // ~1MB per file
        
        log(`Step 1: Reading TAR header region (${formatBytes(estimatedHeaderRegionSize)})...`, 'info');
        const headerRegionBlob = file.slice(tarStartOffset, tarStartOffset + estimatedHeaderRegionSize);
        const headerRegionBuffer = await headerRegionBlob.arrayBuffer();
        const headerRegion = new Uint8Array(headerRegionBuffer);
        
        log(`Step 2: Parsing TAR headers from memory...`, 'info');
        
        // Parse all headers from the region we read
        const tarEntries = [];
        let currentOffset = 0;
        
        while (currentOffset < headerRegion.length && tarEntries.length < maxFiles) {
            if (currentOffset + 512 > headerRegion.length) break;
            
            const headerData = headerRegion.slice(currentOffset, currentOffset + 512);
            
            // Check for empty header
            let allZero = true;
            for (let j = 0; j < 512; j++) {
                if (headerData[j] !== 0) {
                    allZero = false;
                    break;
                }
            }
            if (allZero) break;
            
            // Parse header
            const filename = readString(headerData, 0, 100).trim();
            const sizeStr = readString(headerData, 124, 12).trim();
            const size = parseInt(sizeStr, 8);
            
            if (!filename || isNaN(size) || size < 0) {
                currentOffset += 512;
                continue;
            }
            
            const fileDataOffset = tarStartOffset + currentOffset + 512;
            const isCompressed = filename.toLowerCase().endsWith('.lz4') || filename.toLowerCase().endsWith('.gz');
            
            tarEntries.push({
                filename,
                size,
                fileDataOffset,
                isCompressed,
                header: headerData
            });
            
            log(`  ✓ ${filename}: ${formatBytes(size)} at offset ${fileDataOffset}${isCompressed ? ' (compressed)' : ''}`, 'info');
            
            // Move to next header
            const paddedSize = Math.ceil(size / 512) * 512;
            currentOffset += 512 + paddedSize;
        }
        
        log(`Found ${tarEntries.length} files in TAR`, 'success');
        
        // STEP 3: Create blob slices AND read compressed files immediately
        log(`Step 3: Creating blob slices and reading compressed files...`, 'info');
        const fileInfos = [];
        
        for (const entry of tarEntries) {
            // Create blob slice
            const dataBlob = file.slice(entry.fileDataOffset, entry.fileDataOffset + entry.size);
            
            // If compressed, read it RIGHT NOW (don't defer!)
            let fileData = null;
            if (entry.isCompressed) {
                try {
                    log(`  Reading compressed: ${entry.filename} (${formatBytes(entry.size)})...`, 'info');
                    const buffer = await dataBlob.arrayBuffer();
                    fileData = new Uint8Array(buffer);
                    log(`  ✓ Loaded: ${entry.filename} (${formatBytes(fileData.length)})`, 'success');
                } catch (error) {
                    log(`  ✗ Failed to read ${entry.filename}: ${error.message}`, 'error');
                    throw new Error(`Failed to read ${entry.filename}: ${error.message}`);
                }
            }
            
            fileInfos.push({
                filename: entry.filename,
                size: entry.size,
                fileDataOffset: entry.fileDataOffset,
                isCompressed: entry.isCompressed,
                header: entry.header,
                dataBlob: dataBlob,
                data: fileData  // Compressed data already loaded, or null
            });
        }
        
        const filesFound = fileInfos.length;
        log(`Found and processed ${filesFound} files in TAR`, 'success');
        
        // STEP 2: Create firmware items from parsed data
        for (const fileInfo of fileInfos) {
            // Compressed files have pre-read data, uncompressed files will stream
            const item = new FirmwareItem(fileInfo.filename, fileInfo.data, {
                size: fileInfo.size,
                compression_type: 'none',
                is_compressed: fileInfo.isCompressed,
                isLargeFile: !fileInfo.data,  // Large file if data not loaded
                fileHandle: file,
                fileOffset: fileInfo.fileDataOffset,
                dataBlob: fileInfo.dataBlob,  // For uncompressed streaming
                actualSize: fileInfo.size,
                tarHeader: fileInfo.header
            });
            
            firmwareData.items.push(item);
        }
        
        log(`TAR parsing complete: found ${filesFound} files`, 'success');
        
        currentFirmware = firmwareData;
        
        // Show firmware items in UI
        if (firmwareData.items.length > 0) {
            const itemsContainer = document.getElementById('firmware-items');
            itemsContainer.innerHTML = '';
            
            for (const item of firmwareData.items) {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'firmware-item';
                
                const nameSpan = document.createElement('span');
                nameSpan.className = 'firmware-item-name';
                nameSpan.textContent = item.filename;
                
                const sizeSpan = document.createElement('span');
                sizeSpan.className = 'firmware-item-size';
                const size = item.info.actualSize || item.info.size;
                sizeSpan.textContent = formatBytes(size);
                
                // Detect compression from first few bytes if possible
                if (item.filename.toLowerCase().includes('.lz4')) {
                    sizeSpan.textContent += ' (LZ4 compressed)';
                } else if (item.filename.toLowerCase().includes('.gz')) {
                    sizeSpan.textContent += ' (GZIP compressed)';
                }
                
                itemDiv.appendChild(nameSpan);
                itemDiv.appendChild(sizeSpan);
                itemsContainer.appendChild(itemDiv);
            }
            
            document.getElementById('firmware-items-container').classList.remove('hidden');
        }
        
        log(`Firmware ready: ${firmwareData.items.length} files (streaming enabled)`, 'success');
        
        // Enable flash button if device is connected
        if (flasher && flasher.isConnected) {
            document.getElementById('flash-btn').disabled = false;
        }
        
    } catch (error) {
        log(`Failed to load large firmware: ${error.message}`, 'error');
        showError(`Failed to load firmware: ${error.message}`);
    }
}

/**
 * Start flashing firmware
 */
async function startFlash() {
    if (!flasher.isConnected) {
        showError('Please connect a device first');
        return;
    }
    
    if (!currentFirmware) {
        showError('Please select a firmware file first');
        return;
    }
    
    // Confirm with user
    const confirmMsg = 'WARNING: Flashing firmware can brick your device if done incorrectly.\n\n' +
                      'Make sure:\n' +
                      '- Firmware matches your device model\n' +
                      '- Device is charged >70%\n' +
                      '- Using a good USB cable\n\n' +
                      'Continue?';
    
    if (!confirm(confirmMsg)) {
        return;
    }
    
    isFlashing = true;
    
    // Update UI
    document.getElementById('flash-btn').disabled = true;
    document.getElementById('stop-btn').disabled = false;
    document.getElementById('connect-btn').disabled = true;
    
    log('Starting firmware flash...', 'info');
    updateProgress(0, 'Initializing...');
    
    try {
        const rebootCheckbox = document.getElementById('option-reboot');
        const reboot = rebootCheckbox?.checked ?? true;
        
        log(`Auto-reboot setting: ${reboot ? 'ENABLED' : 'DISABLED'}`, reboot ? 'info' : 'warning');
        
        // Start flashing with progress callback
        const success = await flasher.flash(
            currentFirmware,
            null,  // PIT data (optional)
            reboot,
            (progress) => {
                updateProgress(
                    progress.percentage,
                    `Flashing ${progress.currentFile}: ${formatBytes(progress.bytesTransferred)} / ${formatBytes(progress.totalBytes)}`
                );
            }
        );
        
        if (success) {
            updateProgress(100, 'Flash complete!');
            log('✅ Firmware flashed successfully!', 'success');
            
            if (reboot) {
            showSuccess('Firmware flashed successfully! Your device is rebooting.');
            } else {
                showSuccess('Firmware flashed successfully! Device is still in Download Mode. You can manually reboot it.');
            }
        }
        
    } catch (error) {
        log(`❌ Flash failed: ${error.message}`, 'error');
        showError(`Flash failed: ${error.message}`);
        updateProgress(0, 'Flash failed');
    } finally {
        isFlashing = false;
        document.getElementById('flash-btn').disabled = false;
        document.getElementById('stop-btn').disabled = true;
        document.getElementById('connect-btn').disabled = false;
    }
}

/**
 * Stop flashing (emergency stop)
 */
async function stopFlash() {
    if (!isFlashing) return;
    
    if (confirm('Are you sure you want to stop? This may brick your device!')) {
        log('User requested flash stop', 'warning');
        // Note: Actual stopping would require more complex state management
        // For now, just log the warning
        showError('Flash stop requested - please wait for current operation to complete');
    }
}

/**
 * Set up drag and drop for firmware files
 */
function setupDragAndDrop() {
    const dropArea = document.getElementById('file-upload-area');
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.add('active');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.remove('active');
        }, false);
    });
    
    dropArea.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files && files.length > 0) {
            log(`${files.length} file(s) dropped`, 'info');
            
            // Simulate file input event
            const fileList = Array.from(files);
            
            // Check if single ZIP
            if (fileList.length === 1 && fileList[0].name.toLowerCase().endsWith('.zip')) {
                const file = fileList[0];
                log(`ZIP file dropped: ${file.name} (${formatBytes(file.size)})`, 'info');
                await handleZipFile(file);
                return;
            }
            
            // Multiple files - process them all
            await handleMultipleFirmwareFiles(fileList);
        } else {
            log('No file in drop', 'warning');
        }
    }, false);
}

/**
 * Update verbose mode
 */
document.getElementById('option-verbose')?.addEventListener('change', (e) => {
    if (flasher) {
        flasher.verbose = e.target.checked;
        if (flasher.firmwareParser) flasher.firmwareParser.verbose = e.target.checked;
        if (flasher.pitParser) flasher.pitParser.verbose = e.target.checked;
        if (flasher.downloadEngine) flasher.downloadEngine.verbose = e.target.checked;
        if (flasher.usbDevice) flasher.usbDevice.verbose = e.target.checked;
    }
});

/**
 * Keyboard shortcuts
 */
document.addEventListener('keydown', (e) => {
    // Ctrl+O or Cmd+O to open file
    if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        document.getElementById('firmware-file').click();
    }
});

/**
 * Handle window close
 */
window.addEventListener('beforeunload', (e) => {
    if (isFlashing) {
        e.preventDefault();
        e.returnValue = 'Flashing in progress. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Log browser and system info
log(`Browser: ${navigator.userAgent}`, 'info');
log(`WebUSB supported: ${!!navigator.usb}`, 'info');

