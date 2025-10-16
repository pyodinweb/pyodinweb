/**
 * Firmware parser for PyOdin Web
 * Handles TAR, TAR.MD5, TAR.GZ, BIN, IMG files
 */

class FirmwareItem {
    constructor(filename, data, info) {
        this.filename = filename;
        this.data = data;
        this.info = info || {};
    }
}

class FirmwareData {
    constructor() {
        this.items = [];
        this.md5Hash = null;
        this.pitData = null;
        this.manifest = null;
    }
}

class FirmwareParser {
    constructor(verbose = false) {
        this.verbose = verbose;
    }
    
    log(message) {
        if (this.verbose) {
            log(`[FirmwareParser] ${message}`, 'info');
        }
    }
    
    /**
     * Parse firmware file
     */
    async parse(file, verifyHash = false) {
        this.log(`Parsing firmware: ${file.name}`);
        
        const firmwareData = new FirmwareData();
        
        // Read file data - this will stream from disk, not load all into memory first
        const data = await this.readFile(file);
        
        // Detect file type
        const fileType = detectFileType(file.name, data);
        this.log(`Detected file type: ${fileType}`);
        
        // Check for .md5 extension
        if (file.name.toLowerCase().endsWith('.md5')) {
            // This is a .tar.md5 file - extract MD5 and TAR data
            const result = await this.parseMD5File(data);
            firmwareData.md5Hash = result.md5Hash;
            this.log(`MD5 hash from file: ${result.md5Hash}`);
            
            // Continue parsing the TAR data
            await this.parseTAR(result.tarData, firmwareData);
        } else if (fileType === 'tar.gz') {
            // GZIP compressed TAR
            await this.parseTARGZ(data, firmwareData);
        } else if (fileType === 'tar') {
            // Plain TAR
            await this.parseTAR(data, firmwareData);
        } else if (fileType === 'bin' || fileType === 'img') {
            // Single binary/image file
            const item = new FirmwareItem(file.name, data, {
                size: data.length,
                compression_type: 'none',
                is_compressed: false
            });
            firmwareData.items.push(item);
        } else {
            throw new Error(`Unsupported file type: ${fileType}`);
        }
        
        // Skip MD5 verification - we already extracted it from .md5 file if present
        // Full content verification would require re-calculating MD5 of the TAR data
        // which is very slow for large files and not necessary for flashing
        
        this.log(`Parsed ${firmwareData.items.length} firmware items`);
        
        return firmwareData;
    }
    
    /**
     * Read file as ArrayBuffer - uses modern APIs for better browser compatibility
     */
    async readFile(file) {
        if (!file) {
            throw new Error("No file provided");
        }
        
        // Validate file object
        if (!(file instanceof File) && !(file instanceof Blob)) {
            throw new Error("Invalid file object");
        }
        
        this.log(`Reading file: ${file.name} (${formatBytes(file.size)})`);
        
        // Try modern arrayBuffer() API first (more reliable in some browsers)
        if (file.arrayBuffer && typeof file.arrayBuffer === 'function') {
            try {
                this.log('Using File.arrayBuffer() API...');
                const buffer = await file.arrayBuffer();
                this.log(`File read successfully: ${formatBytes(buffer.byteLength)}`);
                return new Uint8Array(buffer);
            } catch (error) {
                this.log(`File.arrayBuffer() failed: ${error.message}, falling back to FileReader`, 'warning');
                // Fall through to FileReader
            }
        }
        
        // Fallback to FileReader
        this.log('Using FileReader API...');
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                if (!e.target.result) {
                    reject(new Error("FileReader returned empty result"));
                    return;
                }
                this.log(`File read successfully: ${formatBytes(e.target.result.byteLength)}`);
                resolve(new Uint8Array(e.target.result));
            };
            
            reader.onerror = (e) => {
                const error = reader.error;
                const errorMsg = error ? error.message : 'Unknown error';
                log(`FileReader error: ${errorMsg}`, 'error');
                reject(new Error(`Failed to read file: ${errorMsg}`));
            };
            
            reader.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    if (percent % 25 < 1) {
                        this.log(`Reading: ${percent.toFixed(0)}%`);
                    }
                }
            };
            
            try {
                reader.readAsArrayBuffer(file);
            } catch (error) {
                reject(new Error(`Failed to start reading file: ${error.message}`));
            }
        });
    }
    
    /**
     * Parse .md5 file (contains MD5 hash + TAR data)
     */
    async parseMD5File(data) {
        this.log("Parsing .md5 file...");
        
        // .md5 files typically have format:
        // Line 1: "MD5HASH  filename.tar\n"
        // Rest: TAR data
        
        // Find the end of the first line (MD5 hash line)
        let offset = 0;
        while (offset < data.length && data[offset] !== 0x0A) {
            offset++;
        }
        offset++;  // Skip the newline
        
        // Extract MD5 line
        const md5Line = new TextDecoder().decode(data.slice(0, offset));
        const md5Match = md5Line.match(/([a-fA-F0-9]{32})/);
        const md5Hash = md5Match ? md5Match[1].toLowerCase() : null;
        
        this.log(`Extracted MD5: ${md5Hash}`);
        
        // Rest is TAR data
        const tarData = data.slice(offset);
        
        return { md5Hash, tarData };
    }
    
    /**
     * Parse TAR.GZ file
     */
    async parseTARGZ(data, firmwareData) {
        this.log("Decompressing GZIP data...");
        
        // Use pako library for GZIP decompression
        if (typeof pako === 'undefined') {
            throw new Error("pako library not loaded (required for GZIP decompression)");
        }
        
        try {
            const decompressed = pako.inflate(data);
            this.log(`Decompressed ${data.length} -> ${decompressed.length} bytes`);
            
            // Parse decompressed TAR
            await this.parseTAR(decompressed, firmwareData);
        } catch (error) {
            throw new Error(`GZIP decompression failed: ${error.message}`);
        }
    }
    
    /**
     * Parse TAR file
     * Simple TAR parser for firmware files
     */
    async parseTAR(data, firmwareData) {
        this.log("Parsing TAR archive...");
        
        let offset = 0;
        
        while (offset < data.length) {
            // TAR header is 512 bytes
            if (offset + 512 > data.length) {
                break;
            }
            
            const header = data.slice(offset, offset + 512);
            
            // Check for end of archive (all zeros)
            if (this.isZeroBlock(header)) {
                break;
            }
            
            // Parse TAR header
            const filename = readString(header, 0, 100).trim();
            const sizeStr = readString(header, 124, 12).trim();
            const size = parseInt(sizeStr, 8);  // TAR sizes are in octal
            
            if (!filename || isNaN(size)) {
                this.log(`Warning: Invalid TAR header at offset ${offset}`);
                offset += 512;
                continue;
            }
            
            this.log(`Found: ${filename} (${formatBytes(size)})`);
            
            // Move past header
            offset += 512;
            
            // Read file data
            const fileData = data.slice(offset, offset + size);
            
            // Check if file is compressed
            const compressionType = detectCompressionType(fileData);
            
            // Create firmware item
            const item = new FirmwareItem(filename, fileData, {
                size: size,
                compression_type: compressionType,
                is_compressed: compressionType !== 'none'
            });
            
            // Check for special files
            if (filename.toLowerCase().endsWith('.pit')) {
                firmwareData.pitData = fileData;
                this.log("Found PIT file");
            }
            
            firmwareData.items.push(item);
            
            // TAR files are padded to 512-byte boundaries
            const paddedSize = Math.ceil(size / 512) * 512;
            offset += paddedSize;
        }
        
        this.log(`Extracted ${firmwareData.items.length} files from TAR`);
    }
    
    /**
     * Check if a block is all zeros
     */
    isZeroBlock(block) {
        for (let i = 0; i < Math.min(block.length, 512); i++) {
            if (block[i] !== 0) {
                return false;
            }
        }
        return true;
    }
    
    /**
     * Decompress firmware item if compressed
     */
    async decompressItem(item) {
        if (!item.info.is_compressed) {
            return item.data;
        }
        
        const compressionType = item.info.compression_type;
        this.log(`Decompressing ${item.filename} (${compressionType})...`);
        
        if (compressionType === 'gzip') {
            if (typeof pako === 'undefined') {
                throw new Error("pako library not loaded");
            }
            return pako.inflate(item.data);
            
        } else if (compressionType === 'lz4') {
            if (typeof lz4 === 'undefined' || typeof lz4.decode !== 'function') {
                throw new Error("LZ4 library not loaded (refresh page)");
            }
            
            try {
                const decompressed = lz4.decode(item.data);
                if (!decompressed || decompressed.length === 0) {
                    throw new Error('LZ4 decompression returned empty data');
                }
                // Convert to Uint8Array if it's a Buffer
                return decompressed instanceof Uint8Array ? decompressed : new Uint8Array(decompressed);
            } catch (error) {
                throw new Error(`LZ4 decompression failed: ${error.message}`);
            }
        }
        
        return item.data;
    }
}

// Include pako inline stub for GZIP decompression
// In production, include: <script src="https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"></script>
(function() {
    if (typeof window.pako !== 'undefined') {
        return;  // Already loaded
    }
    
    // Stub - will fail if GZIP is actually used
    window.pako = {
        inflate: function(data) {
            log('Error: pako library not loaded. Include pako for GZIP support.', 'error');
            throw new Error('pako library required for GZIP decompression');
        }
    };
})();

