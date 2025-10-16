/**
 * Download Engine - Odin Protocol Implementation
 * Port of PyOdin's download_engine.py
 */

class DownloadProgress {
    constructor() {
        this.percentage = 0;
        this.currentFile = "";
        this.bytesTransferred = 0;
        this.totalBytes = 0;
        this.speed = 0;
    }
}

class DownloadEngine {
    constructor(usbDevice, verbose = false) {
        this.usbDevice = usbDevice;
        this.verbose = verbose;
        this.packetSize = 1024;  // CRITICAL: Must be 1024 for command packets
        this.fileTransferPacketSize = 131072;  // 128KB for data blocks (0x1E00000 max chunk = 30MB)
        this.protocolVersion = 0;
        this.progressCallback = null;
        this.lastProgressUpdate = Date.now();
    }
    
    log(message) {
        if (this.verbose) {
            log(`[DownloadEngine] ${message}`, 'info');
        }
    }
    
    setProgressCallback(callback) {
        this.progressCallback = callback;
    }
    
    /**
     * Initial handshake with device
     * Send "ODIN" and receive "LOKE" (4 bytes each)
     * From odin4.c line 12670
     */
    async handshake() {
        this.log("Performing handshake...");
        
        try {
            // Send "ODIN" (4 bytes literal string)
            const odinBytes = new TextEncoder().encode("ODIN");
            const written = await this.usbDevice.write(odinBytes);
            
            if (written !== 4) {
                log(`Handshake: wrote ${written} bytes, expected 4`, 'error');
                return false;
            }
            
            this.log("Sent 'ODIN', waiting for 'LOKE'...");
            
            // Receive response (expect "LOKE")
            const resp = await this.usbDevice.read(64, TIMEOUT_HANDSHAKE);
            
            if (resp.length < 4) {
                log(`Handshake: received ${resp.length} bytes, expected 4`, 'error');
                return false;
            }
            
            // Check for "LOKE" (0x4C 0x4F 0x4B 0x45)
            const responseStr = new TextDecoder().decode(resp.slice(0, 4));
            this.log(`Received: '${responseStr}' (${resp[0]}, ${resp[1]}, ${resp[2]}, ${resp[3]})`);
            
            if (resp[0] === 76 && resp[1] === 79 && resp[2] === 75 && resp[3] === 69) {
                this.log("✓ Handshake OK (received 'LOKE')");
                return true;
            }
            
            log(`Handshake failed: expected 'LOKE', got '${responseStr}'`, 'error');
            return false;
            
        } catch (error) {
            log(`Handshake failed: ${error.message}`, 'error');
            return false;
        }
    }
    
    /**
     * Get device information
     */
    async getDeviceInfo() {
        this.log("Getting device info...");
        
        // This would be implemented with specific Odin commands
        // For now, return basic info from USB device
        return this.usbDevice.deviceInfo;
    }
    
    /**
     * Send PIT info to device
     * From odin4.c line 14405-14441
     * 
     * For protocol v2/v3, this is actually a no-op when there's no PIT data to send.
     * The actual PIT exchange happens in receivePitData.
     */
    async sendPitInfo() {
        this.log("Sending PIT info...");
        
        // From odin4.c line 14415: if no PIT data, just return success
        // The command is only sent if we have PIT data to upload
        // Since we're just retrieving the PIT from device, this is a no-op
        
        this.log("✓ PIT info sent (no-op without PIT data)");
        return true;
    }
    
    /**
     * Send PIT data to device
     */
    async sendPitData(pitData) {
        this.log(`Sending PIT data (${pitData.length} bytes)...`);
        
        try {
            // Send PIT data in chunks
            const chunkSize = 0x100000;  // 1MB chunks
            let offset = 0;
            
            while (offset < pitData.length) {
                const end = Math.min(offset + chunkSize, pitData.length);
                const chunk = pitData.slice(offset, end);
                
                await this.usbDevice.write(chunk);
                offset = end;
                
                this.log(`  Sent ${offset}/${pitData.length} bytes`);
            }
            
            // Wait for confirmation
            const resp = await this.usbDevice.read(64, TIMEOUT_TRANSFER);
            
            if (resp.length >= 8) {
                const [cmd, result] = structUnpack('<II', resp);
                return result === 0;
            }
            
            return true;
        } catch (error) {
            log(`sendPitData failed: ${error.message}`, 'error');
            return false;
        }
    }
    
    /**
     * Receive PIT data from device
     * From odin4.c line 14476-14600
     * EXACT implementation - uses command 101
     */
    async receivePitData() {
        this.log("Requesting PIT from device...");
        
        try {
            // Step 1: Get PIT size using command 101/1
            const buf = new Uint8Array(1024);
            buf.set(structPack('<III', 101, 1, 0), 0);
            
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            
            // Read response with retry
            let resp = null;
            for (let retry = 0; retry < 2; retry++) {
                resp = await this.usbDevice.read(64, 60);
                if (resp && resp.length >= 8) {
                    break;
                }
            }
            
            if (!resp || resp.length < 8) {
                throw new Error("PIT request timeout");
            }
            
            const [respCmd, respData] = structUnpack('<II', resp);
            
            if (respCmd !== 101) {
                throw new Error(`PIT cmd=${respCmd}, expected 101`);
            }
            
            const pitSize = respData;
            this.log(`PIT size: ${pitSize} bytes`);
            
            // Sanity check
            if (pitSize === 0 || pitSize > 0x100000) {
                throw new Error(`Invalid PIT size: ${pitSize}`);
            }
            
            // Step 2: Read PIT in 500-byte chunks (from odin4.c line 14552-14568)
            const pitData = [];
            let counter = 0;
            let remaining = pitSize;
            
            while (remaining > 0) {
                // Send read request: 101/2/counter
                buf.fill(0);
                buf.set(structPack('<III', 101, 2, counter), 0);
                await this.usbDevice.write(buf.slice(0, this.packetSize));
                
                // Read chunk (max 500 bytes per chunk)
                const readSize = Math.min(500, remaining);
                const chunk = await this.usbDevice.read(readSize, 60);
                
                if (chunk.length === 0) {
                    break;
                }
                
                pitData.push(chunk);
                remaining -= chunk.length;
                counter++;
                
                this.log(`  Read chunk ${counter}: ${chunk.length} bytes, ${remaining} remaining`);
            }
            
            this.log(`Read ${pitSize - remaining} bytes in ${counter} chunks`);
            
            // Step 3: Finalize (command 101/3)
            buf.fill(0);
            buf.set(structPack('<III', 101, 3, 0), 0);
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            await this.usbDevice.read(64, 60);
            
            // Concatenate all chunks
            const finalPitData = concatUint8Arrays(...pitData);
            
            if (finalPitData.length !== pitSize) {
                this.log(`Warning: PIT size mismatch: ${finalPitData.length}/${pitSize}`);
            }
            
            this.log(`✓ PIT received (${finalPitData.length} bytes)`);
            return finalPitData;
            
        } catch (error) {
            log(`receivePitData failed: ${error.message}`, 'error');
            throw error;
        }
    }
    
    /**
     * Upload firmware binaries to device
     * EXACT implementation from PyOdin download_engine.py
     */
    async uploadBinaries(firmwareData, pitData) {
        this.log(`Uploading ${firmwareData.items.length} items...`);
        
        // CRITICAL: Match to PIT BEFORE transfers (like PyOdin line 684-759)
        if (pitData) {
            const pitParser = new PitParser(this.verbose);
            const pit = pitParser.parse(pitData);
            
            for (const item of firmwareData.items) {
                const fname = item.filename.toLowerCase();
                const fnameBase = fname.replace('.lz4', '').replace('.gz', '').replace('.img', '').replace('.bin', '');
                
                let matched = false;
                for (const entry of pit.entries) {
                    const partName = entry.partitionName.toLowerCase();
                    const flashName = entry.flashFilename.toLowerCase();
                    const flashNameBase = flashName.replace('.img', '').replace('.bin', '');
                    
                    if (fname === flashName || 
                        fnameBase === flashNameBase ||
                        fnameBase === partName ||
                        fnameBase.replace('-', '_') === partName.replace('-', '_')) {
                        item.info.partition_id = entry.partitionId;
                        item.info.device_type = entry.deviceType;
                        this.log(`  Matched: ${item.filename} → ${entry.partitionName} (ID=${entry.partitionId}, type=${entry.deviceType})`);
                        matched = true;
                        break;
                    }
                }
                
                if (!matched) {
                    this.log(`  WARNING: No PIT match for ${item.filename}`);
                    // Set defaults
                    if (!item.info.device_type) item.info.device_type = 2;
                    this.log(`    Using defaults: ID=${item.info.partition_id}, type=${item.info.device_type}`);
                }
            }
        } else {
            // No PIT - use filename-based detection (PyOdin line 720-758)
            this.log("  No PIT - detecting partitions from filenames...");
            for (const item of firmwareData.items) {
                const fname = item.filename.toLowerCase();
                if (fname.includes('boot') && !fname.includes('recovery')) {
                    item.info.partition_id = 3;
                    item.info.device_type = 2;
                } else if (fname.includes('recovery')) {
                    item.info.partition_id = 10;
                    item.info.device_type = 2;
                } else if (fname.includes('sboot') || fname.startsWith('bl') || fname.includes('bootloader')) {
                    item.info.partition_id = 80;
                    item.info.device_type = 2;
                } else if (fname.includes('modem') || fname.includes('radio') || fname.includes('cp')) {
                    item.info.partition_id = 11;
                    item.info.device_type = 2;
                } else {
                    // Default
                    if (!item.info.partition_id) item.info.partition_id = 0;
                    if (!item.info.device_type) item.info.device_type = 2;
                }
                this.log(`  ${item.filename} → ID=${item.info.partition_id}, type=${item.info.device_type}`);
            }
        }
        
        // Now transfer each file
        for (let i = 0; i < firmwareData.items.length; i++) {
            const item = firmwareData.items[i];
            
            // Skip items with neither data nor file handle
            if (!item.data && !item.info.isLargeFile) {
                this.log(`Skipping ${item.filename} - no data available`);
                continue;
            }
            
            // Skip if it's an empty file
            if (item.data && item.data.length === 0) {
                this.log(`Skipping ${item.filename} - empty file`);
                continue;
            }
            
            // Skip meta-data files
            if (item.filename.includes('meta-data/') || item.filename.endsWith('.zip')) {
                this.log(`Skipping ${item.filename} - metadata`);
                continue;
            }
            
            this.log(`\n>>> Processing item ${i + 1}/${firmwareData.items.length}: ${item.filename}`);
            
            // Transfer the file using the exact Python protocol
            const success = await this.transferFile(item);
            if (!success) {
                throw new Error(`Failed to transfer ${item.filename}`);
            }
            
            this.log(`✓ Completed ${item.filename}`);
        }
        
        this.log("All binaries uploaded successfully");
        return true;
    }
    
    /**
     * Transfer single file to device
     * From odin4.c line 14762 and download_engine.py line 446
     */
    async transferFile(item) {
        this.log(`==== Transferring: ${item.filename} ====`);
        this.log(`  Partition ID: ${item.info.partition_id}, Device type: ${item.info.device_type}`);
        this.log(`  item.data: ${item.data ? 'present' : 'null'}`);
        this.log(`  item.info.isLargeFile: ${item.info.isLargeFile}`);
        this.log(`  item.info.is_compressed: ${item.info.is_compressed}`);
        this.log(`  item.info.compression_type: ${item.info.compression_type}`);
        
        // Get file data (extract from TAR on-demand if needed)
        let data;
        let fileSize;
        
        if (item.data) {
            // Data already loaded
            this.log(`  Using pre-loaded data: ${formatBytes(item.data.length)}`);
            data = item.data;
            fileSize = item.data.length;
        } else if (item.info.isLargeFile && item.info.fileHandle && item.info.fileOffset !== undefined) {
            // Extract file from TAR on-demand
            if (item.info.is_compressed) {
                // Compressed file
                this.log(`  Compressed file: ${item.filename}`);
                this.log(`    Offset: ${item.info.fileOffset}, Compressed size: ${formatBytes(item.info.actualSize)}`);
                
                if (item.info.actualSize > 4 * 1024 * 1024 * 1024) {
                    // File > 4GB - use STREAMING decompression!
                    this.log(`  File exceeds 4GB - using streaming decompression mode`);
                    this.log(`  Will decompress and send in chunks (never load full file into memory)`);
                    
                    // Set up for streaming - data=null means streaming mode
                    data = null;
                    fileSize = item.info.actualSize;  // We'll determine actual size during decompression
                    
                } else {
                    // File < 4GB - extract normally
                    this.log(`  Extracting compressed file from TAR`);
                    const fileBlob = item.info.fileHandle.slice(item.info.fileOffset, item.info.fileOffset + item.info.actualSize);
                    const fileBuffer = await fileBlob.arrayBuffer();
                    data = new Uint8Array(fileBuffer);
                    fileSize = data.length;
                    this.log(`  ✓ Extracted ${formatBytes(data.length)} (will decompress next)`);
                }
                
            } else {
                // Uncompressed file - can stream it
                this.log(`  Large uncompressed file - streaming mode`);
                this.log(`    Offset: ${item.info.fileOffset}, Size: ${formatBytes(item.info.actualSize)}`);
                data = null;
                fileSize = item.info.actualSize;
            }
        } else {
            this.log(`  ERROR: No data source available!`, 'error');
            this.log(`    item.data: ${item.data}`);
            this.log(`    item.info.isLargeFile: ${item.info.isLargeFile}`);
            this.log(`    item.info.fileHandle: ${!!item.info.fileHandle}`);
            this.log(`    item.info.fileOffset: ${item.info.fileOffset}`);
            throw new Error(`No data available for ${item.filename}`);
        }
        
        // Handle compression
        let isStreamingCompressed = false;
        
        if (item.info.is_compressed) {
            // Detect compression type
            let compressionType = item.info.compression_type;
            if (compressionType === 'none' || !compressionType) {
                if (item.filename.endsWith('.lz4')) {
                    compressionType = 'lz4';
                } else if (item.filename.endsWith('.gz')) {
                    compressionType = 'gzip';
                }
            }
            
            if (data) {
                // Have compressed data in memory - decompress it
                this.log(`  Decompressing (${compressionType})...`);
                const compressedSize = data.length;
                
                if (compressionType === 'gzip') {
                    if (typeof pako === 'undefined') {
                        throw new Error('pako library required for GZIP decompression');
                    }
                    data = pako.inflate(data);
                    this.log(`  ✓ Decompressed GZIP: ${formatBytes(compressedSize)} → ${formatBytes(data.length)}`);
                    
                } else if (compressionType === 'lz4') {
                    if (typeof lz4 === 'undefined' || typeof lz4.decode !== 'function') {
                        throw new Error('LZ4 library not loaded');
                    }
                    
                    const decompressed = lz4.decode(data);
                    if (!decompressed || decompressed.length === 0) {
                        throw new Error('LZ4 decompression returned empty data');
                    }
                    data = decompressed instanceof Uint8Array ? decompressed : new Uint8Array(decompressed);
                    this.log(`  ✓ Decompressed LZ4: ${formatBytes(compressedSize)} → ${formatBytes(data.length)}`);
                }
                
                fileSize = data.length;
                
            } else {
                // Streaming compressed mode - decompress on the fly
                this.log(`  Setup: Streaming LZ4 decompression (file too large to load at once)`);
                isStreamingCompressed = true;
                // fileSize stays as compressed size for now, we'll get actual size during decompression
            }
        }
        
        // Get partition info (needed for both streaming and normal modes)
        const partitionId = item.info.partition_id || 0;
        const deviceType = item.info.device_type || 2;
        
        // For streaming compressed - use streaming decoder
        if (isStreamingCompressed) {
            this.log(`  Using TRUE STREAMING decompression (block-by-block)`);
            this.log(`  This processes the file in small blocks without loading everything into memory`);
            
            // Handle it with special streaming transfer function
            item.info.useStreamingLZ4 = true;
            this.log(`  Streaming mode enabled for ${item.filename}`);
            
            return await this.transferFileStreamingLZ4(item, partitionId, deviceType);
        }
        
        this.log(`  Final size to send: ${formatBytes(fileSize)}`);
        
        let offset = 0;
        
        try {
            // Step 1: Send FileTransferPacket (102/0) to activate
            this.log(`  Activating file transfer (102/0)...`);
            const buf = new Uint8Array(1024);
            buf.set(structPack('<III', 102, 0, 0), 0);
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            
            const resp = await this.usbDevice.read(64, 60);
            if (resp.length < 8) {
                throw new Error("File transfer activation timeout");
            }
            
            const [respCmd, respData] = structUnpack('<II', resp);
            if (respCmd !== 102) {
                throw new Error(`File transfer activation rejected: cmd=${respCmd}`);
            }
            this.log(`  File transfer activated`);
            
            // Step 2: Main transfer loop - send in chunks (max 30MB per chunk)
            const MAX_CHUNK_SIZE = 0x1E00000;  // 30MB
            let sequenceNum = 0;
            
            while (offset < fileSize) {
                const remaining = fileSize - offset;
                const chunkSize = Math.min(remaining, MAX_CHUNK_SIZE);
                this.log(`  Sequence ${sequenceNum}: offset=${offset}, chunk=${formatBytes(chunkSize)}`);
                
                // Begin sequence (102/2)
                this.log(`  Sending sequence begin (102/2)...`);
                buf.fill(0);
                buf.set(structPack('<III', 102, 2, chunkSize), 0);
                await this.usbDevice.write(buf.slice(0, this.packetSize));
                
                const resp2 = await this.usbDevice.read(64, 60);
                if (resp2.length < 8) {
                    throw new Error("Sequence begin timeout");
                }
                
                const [cmd2, data2] = structUnpack('<II', resp2);
                if (cmd2 !== 102) {
                    throw new Error(`Sequence begin rejected: cmd=${cmd2}`);
                }
                this.log(`  Sequence begin accepted`);
                
                // Small delay for device to prepare
                await sleep(100);
                
                // Send data blocks
                this.log(`  Sending ${formatBytes(chunkSize)} in ${formatBytes(this.fileTransferPacketSize)} blocks...`);
                if (data) {
                    this.log(`  Data array length: ${data.length}, FileSize: ${fileSize}, Offset: ${offset}`);
                } else {
                    this.log(`  STREAMING mode: will read from file on-the-fly`);
                }
                
                let chunkOffset = 0;
                let blockCount = 0;
                
                while (chunkOffset < chunkSize) {
                    const blockSize = Math.min(this.fileTransferPacketSize, chunkSize - chunkOffset);
                    
                    let block;
                    
                    if (data) {
                        // Read from pre-loaded data array
                        const blockStart = offset + chunkOffset;
                        const blockEnd = blockStart + blockSize;
                        
                        // Safety check
                        if (blockStart >= data.length) {
                            this.log(`    CRITICAL ERROR: blockStart ${blockStart} >= data.length ${data.length}`, 'error');
                            this.log(`    offset=${offset}, chunkOffset=${chunkOffset}, fileSize=${fileSize}`, 'error');
                            throw new Error(`Reading beyond data array: ${blockStart} >= ${data.length}`);
                        }
                        
                        block = data.slice(blockStart, blockEnd);
                        
                        if (blockCount === 0) {
                            this.log(`  First block slice: data[${blockStart}:${blockEnd}] (data.length=${data.length})`);
                            this.log(`  First 32 bytes of block: ${bytesToHex(block.slice(0, 32))}`);
                        }
                    } else {
                        // STREAMING: Read from file handle on-the-fly (like PyOdin line 544-545)
                        const fileBlockStart = item.info.fileOffset + offset + chunkOffset;
                        const fileBlockEnd = fileBlockStart + blockSize;
                        
                        if (blockCount === 0) {
                            this.log(`  First block: reading file bytes ${fileBlockStart} to ${fileBlockEnd}`);
                        }
                        
                        try {
                            const blockBlob = item.info.fileHandle.slice(fileBlockStart, fileBlockEnd);
                            block = new Uint8Array(await blockBlob.arrayBuffer());
                            
                            if (blockCount === 0) {
                                this.log(`  First 32 bytes of block: ${bytesToHex(block.slice(0, 32))}`);
                            }
                        } catch (error) {
                            this.log(`  ERROR reading block from file: ${error.message}`, 'error');
                            throw new Error(`Failed to read block: ${error.message}`);
                        }
                    }
                    
                    // Pad to full packet size
                    if (block.length < this.fileTransferPacketSize) {
                        const padded = new Uint8Array(this.fileTransferPacketSize);
                        padded.set(block);
                        block = padded;
                    }
                    
                    // CRITICAL: Send empty transfer before each block (except first)
                    if (blockCount > 0) {
                        this.log(`    Block ${blockCount}: sending empty transfer...`);
                        try {
                            // Empty transfer for device sync - ignore errors
                            await this.usbDevice.write(new Uint8Array(0));
                        } catch (e) {}
                    }
                    
                    this.log(`    Block ${blockCount}: sending ${block.length} bytes (actual=${blockSize})`);
                    
                    // Send data block
                    const written = await this.usbDevice.write(block);
                    this.log(`    Block ${blockCount}: wrote ${written} bytes`);
                    
                    if (written !== this.fileTransferPacketSize) {
                        throw new Error(`Expected to write ${this.fileTransferPacketSize}, wrote ${written}`);
                    }
                    
                    // Read response
                    const blockResp = await this.usbDevice.read(64, 60);
                    if (blockResp.length !== 8) {
                        throw new Error(`Expected 8-byte response, got ${blockResp.length}`);
                    }
                    
                    chunkOffset += blockSize;
                    blockCount++;
                    
                    // Update progress
                    if (this.progressCallback) {
                        const progress = new DownloadProgress();
                        progress.currentFile = item.filename;
                        progress.bytesTransferred = offset + chunkOffset;
                        progress.totalBytes = fileSize;
                        progress.percentage = ((offset + chunkOffset) / fileSize) * 100;
                        
                        const now = Date.now();
                        if (now - this.lastProgressUpdate > 500) {
                            this.progressCallback(progress);
                            this.lastProgressUpdate = now;
                        }
                    }
                }
                
                this.log(`  Sent ${blockCount} blocks, total ${formatBytes(chunkOffset)}`);
                
                // Step 3: Finalize chunk (102/3)
                const remainingAfter = fileSize - (offset + chunkSize);
                const completionStatus = remainingAfter <= 0 ? 1 : 0;
                
                this.log(`  Finalizing sequence (102/3)...`);
                buf.fill(0);
                buf.set(structPack('<II', 102, 3), 0);
                buf.set(structPack('<IIIIII', 
                    0,              // destination (0=Phone)
                    chunkOffset,    // actual bytes in sequence (unpadded)
                    0,              // unknown
                    deviceType,     // device type from PIT
                    partitionId,    // partition ID from PIT
                    completionStatus  // 1=last chunk, 0=more coming
                ), 8);
                
                this.log(`  Finalize: size=${chunkOffset}, part_id=${partitionId}, dev_type=${deviceType}, status=${completionStatus}`);
                this.log(`  FULL PACKET HEX (first 64 bytes):`);
                const hexStr = bytesToHex(buf.slice(0, 64));
                for (let i = 0; i < hexStr.length; i += 32) {
                    this.log(`    ${String(i/2).padStart(4, '0')}: ${hexStr.slice(i, i+32)}`);
                }
                
                // CRITICAL: Empty transfer before 102/3
                this.log(`  Sending empty transfer before 102/3...`);
                try { await this.usbDevice.write(new Uint8Array(0)); } catch (e) {}
                
                // Send 102/3 packet
                await this.usbDevice.write(buf.slice(0, this.packetSize));
                
                // CRITICAL: Empty transfer after 102/3
                this.log(`    Sending empty transfer after 102/3...`);
                try { await this.usbDevice.write(new Uint8Array(0)); } catch (e) {}
                
                // Small delay
                await sleep(100);
                
                // Read finalization response (can take up to 120s for flash write)
                this.log(`    Reading finalization response (device writing to flash, may take 2 minutes)...`);
                let finalResp = null;
                try {
                    finalResp = await this.usbDevice.read(64, 120);
                } catch (error) {
                    this.log(`    Timeout after 120s: ${error.message}`);
                }
                
                if (finalResp && finalResp.length >= 8) {
                    const [finalCmd, finalData] = structUnpack('<II', finalResp);
                    this.log(`    Response: cmd=${finalCmd}, data=${finalData}`);
                    
                    if (finalCmd === 0xFFFFFFFF) {
                        throw new Error(`Finalize rejected, code=${finalData}`);
                    }
                    if (finalCmd !== 102) {
                        throw new Error(`Unexpected response cmd=${finalCmd}`);
                    }
                } else {
                    this.log(`    No response received`);
                    if (completionStatus === 1) {
                        this.log(`    WARNING: No response on final chunk, continuing anyway...`);
                    } else {
                        throw new Error("No response on intermediate chunk");
                    }
                }
                
                offset += chunkSize;
                sequenceNum++;
            }
            
            this.log(`✓ Complete: ${item.filename}`);
            
            // CRITICAL: Clear memory after successful transfer
            data = null;
            
            // Force garbage collection by creating/discarding large arrays
            try {
                const dummy = new Uint8Array(100 * 1024 * 1024); // 100MB
                dummy[0] = 1; // Touch it so it's allocated
                // Let it be garbage collected
            } catch (e) {
                // Ignore allocation errors
            }
            
            this.log(`  Memory cleared for ${item.filename}`);
            
            // Small delay to let GC run
            await sleep(100);
            
            return true;
            
        } catch (error) {
            this.log(`ERROR transferring ${item.filename}: ${error.message}`);
            // Clear memory even on error
            data = null;
            throw error;
        }
    }
    
    
    /**
     * Transfer file using streaming LZ4 decompression
     * Decompresses and sends blocks WITHOUT loading entire file into memory
     */
    async transferFileStreamingLZ4(item, partitionId, deviceType) {
        this.log(`\n==== TRUE STREAMING LZ4 Transfer: ${item.filename} ====`);
        this.log(`  This will decompress and send data block-by-block`);
        this.log(`  Maximum memory usage: ~128MB (never loads full file)`);
        
        if (typeof StreamingLZ4Decoder === 'undefined') {
            throw new Error('StreamingLZ4Decoder not loaded');
        }
        
        const decoder = new StreamingLZ4Decoder(this.verbose);
        const buf = new Uint8Array(1024);
        
        // Activate file transfer
        this.log(`  Activating file transfer (102/0)...`);
        buf.set(structPack('<III', 102, 0, 0), 0);
        await this.usbDevice.write(buf.slice(0, this.packetSize));
        
        const resp = await this.usbDevice.read(64, 60);
        if (resp.length < 8) throw new Error("File transfer activation timeout");
        
        const [respCmd, respData] = structUnpack('<II', resp);
        if (respCmd !== 102) throw new Error(`File transfer activation rejected: cmd=${respCmd}`);
        
        // Streaming state
        const SEND_BUFFER_SIZE = 30 * 1024 * 1024; // 30MB buffer before sending
        let sendBuffer = new Uint8Array(SEND_BUFFER_SIZE);
        let bufferPos = 0;
        let totalDecompressed = 0;
        let totalSent = 0;
        let sequenceNum = 0;
        
        // Helper function to flush buffer to device
        const flushBuffer = async (isFinal) => {
            if (bufferPos === 0) return;
            
            this.log(`  Flushing ${formatBytes(bufferPos)} to device (sequence ${sequenceNum})...`);
            
            // Begin sequence
            buf.fill(0);
            buf.set(structPack('<III', 102, 2, bufferPos), 0);
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            await this.usbDevice.read(64, 60);
            await sleep(100);
            
            // Send blocks from buffer
            let offset = 0;
            let blockCount = 0;
            
            while (offset < bufferPos) {
                const blockSize = Math.min(this.fileTransferPacketSize, bufferPos - offset);
                let block = sendBuffer.slice(offset, offset + blockSize);
                
                // Pad
                if (block.length < this.fileTransferPacketSize) {
                    const padded = new Uint8Array(this.fileTransferPacketSize);
                    padded.set(block);
                    block = padded;
                }
                
                if (blockCount > 0) {
                    try { await this.usbDevice.write(new Uint8Array(0)); } catch(e) {}
                }
                
                await this.usbDevice.write(block);
                await this.usbDevice.read(64, 60);
                
                offset += blockSize;
                blockCount++;
            }
            
            // Finalize sequence
            const completionStatus = isFinal ? 1 : 0;
            buf.fill(0);
            buf.set(structPack('<II', 102, 3), 0);
            buf.set(structPack('<IIIIII',
                0, bufferPos, 0, deviceType, partitionId, completionStatus
            ), 8);
            
            try { await this.usbDevice.write(new Uint8Array(0)); } catch(e) {}
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            try { await this.usbDevice.write(new Uint8Array(0)); } catch(e) {}
            await sleep(100);
            
            await this.usbDevice.read(64, 120);
            
            totalSent += bufferPos;
            this.log(`  ✓ Sent ${formatBytes(bufferPos)}, total sent: ${formatBytes(totalSent)}`);
            
            // Reset buffer
            bufferPos = 0;
            sequenceNum++;
            
            // Progress
            if (this.progressCallback) {
                const progress = new DownloadProgress();
                progress.currentFile = item.filename;
                progress.bytesTransferred = totalSent;
                progress.totalBytes = totalDecompressed; // Best estimate
                progress.percentage = totalDecompressed > 0 ? (totalSent / totalDecompressed) * 100 : 0;
                this.progressCallback(progress);
            }
        };
        
        // Decompress and send block-by-block
        this.log(`  Starting streaming decompression of ${formatBytes(item.info.actualSize)}...`);
        
        try {
            await decoder.decompressStreaming(
                item.info.fileHandle,
                item.info.fileOffset,
                item.info.actualSize,
                async (decompressedBlock) => {
                    totalDecompressed += decompressedBlock.length;
                    this.log(`  +Block: ${formatBytes(decompressedBlock.length)}, total: ${formatBytes(totalDecompressed)}`);
                    
                    // Add to send buffer
                    let blockOffset = 0;
                    
                    while (blockOffset < decompressedBlock.length) {
                        const copySize = Math.min(SEND_BUFFER_SIZE - bufferPos, decompressedBlock.length - blockOffset);
                        
                        sendBuffer.set(decompressedBlock.slice(blockOffset, blockOffset + copySize), bufferPos);
                        bufferPos += copySize;
                        blockOffset += copySize;
                        
                        // Flush if buffer is full
                        if (bufferPos >= SEND_BUFFER_SIZE) {
                            await flushBuffer(false);
                        }
                    }
                    
                    // Clear the decompressed block immediately
                    decompressedBlock = null;
                }
            );
            
            // Flush any remaining data
            if (bufferPos > 0) {
                await flushBuffer(true);
            }
            
        } catch (error) {
            throw new Error(`Streaming decompression failed: ${error.message}`);
        }
        
        this.log(`✓ Streaming transfer complete: ${formatBytes(totalSent)} sent`);
        
        // Clear memory
        sendBuffer = null;
        
        return true;
    }
    
    /**
     * Inline LZ4 frame decompressor (fallback if library not available)
     * This is a simplified implementation - may not work for all LZ4 variants
     */
    async decompressLZ4Inline(compressedData) {
        this.log('  WARNING: Using basic LZ4 decompression (limited support)');
        
        // For production, user should include proper LZ4 library
        // This is a very basic implementation that may fail on complex LZ4 frames
        
        throw new Error('LZ4 library not loaded. Please include: <script src="https://unpkg.com/lz4js@0.2.0/lz4.js"></script>');
    }
    
    /**
     * Close connection/session
     */
    async closeConnection() {
        this.log("Closing connection...");
        
        try {
            // Send end session command (103/0)
            const buf = new Uint8Array(1024);
            buf.set(structPack('<III', 103, 0, 0), 0);
            
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            
            // Read response
            const resp = await this.usbDevice.read(64, TIMEOUT_TRANSFER);
            
            this.log("Connection closed");
        } catch (error) {
            log(`closeConnection error: ${error.message}`, 'warning');
        }
    }
    
    /**
     * Reboot device
     */
    async rebootDevice() {
        this.log("Rebooting device...");
        
        try {
            // Send reboot command (103/1)
            const buf = new Uint8Array(1024);
            buf.set(structPack('<III', 103, 1, 0), 0);
            
            await this.usbDevice.write(buf.slice(0, this.packetSize));
            
            // Device will disconnect during reboot
            this.log("Reboot command sent");
        } catch (error) {
            // This is expected - device disconnects
            this.log("Device rebooting...");
        }
    }
}

