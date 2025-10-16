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

/**
 * Initialize application
 */
window.addEventListener('DOMContentLoaded', () => {
    log('PyOdin Web initialized', 'success');
    
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
    
    // Set up drag and drop
    setupDragAndDrop();
    
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
 */
async function handleFirmwareSelect(event) {
    const files = event.target.files;
    if (!files || files.length === 0) {
        log('No file selected', 'warning');
        return;
    }
    
    const file = files[0];
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
            
            log(`  ${filename}: ${formatBytes(size)} at offset ${fileDataOffset}`, 'info');
            
            // Create item with NO data - will extract on-demand
            const item = new FirmwareItem(filename, null, {
                size: size,
                compression_type: 'none',
                is_compressed: isCompressed,
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
        const reboot = document.getElementById('option-reboot')?.checked || true;
        
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
            showSuccess('Firmware flashed successfully! Your device is rebooting.');
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
            const originalFile = files[0];
            log(`File dropped: ${originalFile.name} (${formatBytes(originalFile.size)})`, 'info');
            
            try {
                // Read file in chunks to avoid browser size/permission limitations
                log('Reading file in chunks (this may take a moment for large files)...', 'info');
                
                const chunkSize = 64 * 1024 * 1024; // 64MB chunks
                const chunks = [];
                let offset = 0;
                
                while (offset < originalFile.size) {
                    const end = Math.min(offset + chunkSize, originalFile.size);
                    const chunk = originalFile.slice(offset, end);
                    
                    // Read this chunk immediately
                    const chunkData = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        
                        reader.onload = (e) => {
                            if (!e.target.result) {
                                reject(new Error('Chunk read failed'));
                                return;
                            }
                            resolve(new Uint8Array(e.target.result));
                        };
                        
                        reader.onerror = () => {
                            reject(new Error(`Failed to read chunk at ${offset}: ${reader.error?.message || 'Unknown error'}`));
                        };
                        
                        reader.readAsArrayBuffer(chunk);
                    });
                    
                    chunks.push(chunkData);
                    offset = end;
                    
                    const percent = (offset / originalFile.size) * 100;
                    log(`Reading: ${percent.toFixed(1)}% (${formatBytes(offset)} / ${formatBytes(originalFile.size)})`, 'info');
                }
                
                // Concatenate all chunks
                log('Concatenating chunks...', 'info');
                const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const fileData = new Uint8Array(totalSize);
                let writeOffset = 0;
                
                for (const chunk of chunks) {
                    fileData.set(chunk, writeOffset);
                    writeOffset += chunk.length;
                }
                
                log(`✓ File read successfully: ${formatBytes(fileData.length)}`, 'success');
                
                // Create a new File from the data (now fully in memory)
                const file = new File([fileData], originalFile.name, {
                    type: originalFile.type,
                    lastModified: originalFile.lastModified
                });
                
                // Store and parse
                selectedFile = file;
                
                // Parse directly from the data we already have
                await parseFirmwareFromMemory(file.name, fileData);
                
            } catch (error) {
                log(`Error: ${error.message}`, 'error');
                showError(`Failed to access file: ${error.message}`);
            }
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

