/**
 * Main Odin Flasher
 * High-level API for firmware flashing operations
 * Port of PyOdin's flasher.py
 */

class OdinFlasher {
    constructor(verbose = false) {
        this.verbose = verbose;
        this.usbDevice = null;
        this.downloadEngine = null;
        this.firmwareParser = new FirmwareParser(verbose);
        this.pitParser = new PitParser(verbose);
        this.deviceInfo = null;
        this.isConnected = false;
    }
    
    log(message) {
        if (this.verbose) {
            log(`[OdinFlasher] ${message}`, 'info');
        }
    }
    
    /**
     * List all connected Samsung devices in Download mode
     */
    async listDevices() {
        return await UsbDevice.listDevices();
    }
    
    /**
     * Connect to Samsung device
     */
    async connectDevice() {
        this.log("Connecting to device...");
        
        try {
            // Create USB device
            this.usbDevice = new UsbDevice(this.verbose);
            
            // Find and connect to device
            const deviceInfo = await this.usbDevice.findDevice();
            if (!deviceInfo) {
                throw new Error("No Samsung device found in Download mode");
            }
            
            this.log(`Found device: ${deviceInfo}`);
            
            // Connect to device
            if (!await this.usbDevice.connect()) {
                throw new Error("Failed to connect to device");
            }
            
            // Create download engine
            this.downloadEngine = new DownloadEngine(this.usbDevice, this.verbose);
            
            // EXACT protocol sequence from odin4.c:
            
            // Step 1: Handshake (send "ODIN", receive "LOKE")
            this.log("Step 1: Handshake...");
            if (!await this.downloadEngine.handshake()) {
                throw new Error("Failed handshake - device did not respond with 'LOKE'");
            }
            
            // Step 2: Get protocol version (100/0/4)
            this.log("Step 2: Getting protocol version (100/0/4)...");
            const buf = new Uint8Array(1024);
            buf.set(structPack('<III', 100, 0, 4), 0);
            this.log(`Sending ${this.downloadEngine.packetSize} byte packet...`);
            await this.usbDevice.write(buf.slice(0, this.downloadEngine.packetSize));
            
            this.log("Waiting for response (timeout: 60s)...");
            const resp = await this.usbDevice.read(64, 60);  // 60 second timeout
            
            if (resp.length < 8) {
                log(`ERROR: Received only ${resp.length} bytes, expected at least 8`, 'error');
                throw new Error(`No valid response to protocol version request (got ${resp.length} bytes)`);
            }
            
            this.log(`Received ${resp.length} bytes`);
            const [cmd, data] = structUnpack('<II', resp);
            this.log(`Response: cmd=${cmd}, data=0x${data.toString(16).padStart(8, '0')}`);
            
            const version = (data >> 16) & 0xFFFF;
            const deviceDefaultPacketSize = data & 0xFFFF;
            this.downloadEngine.protocolVersion = version;
            this.log(`✓ Protocol version: ${version}, default packet size: ${deviceDefaultPacketSize}`);
            
            // Step 3: Send file part size if device supports it (100/5)
            if (deviceDefaultPacketSize !== 0) {
                this.log("Step 3: Sending file part size (100/5)...");
                buf.fill(0);  // Clear buffer
                buf.set(structPack('<III', 100, 5, 0x100000), 0);  // 1MB
                await this.usbDevice.write(buf.slice(0, this.downloadEngine.packetSize));
                const resp2 = await this.usbDevice.read(64, TIMEOUT_HANDSHAKE);
                
                if (resp2.length >= 8) {
                    const [cmd2, result] = structUnpack('<II', resp2);
                    this.log(`✓ File part size response: ${result}`);
                    if (result !== 0) {
                        throw new Error(`Device rejected file part size: ${result}`);
                    }
                }
            } else {
                this.log("Step 3: Skipped (device doesn't support file part size)");
            }
            
            // NOTE: Step 4 (100/2 with total bytes) is sent later in flash() after firmware is loaded
            
            // Get device info
            this.deviceInfo = await this.downloadEngine.getDeviceInfo();
            this.deviceInfo.protocolVersion = this.downloadEngine.protocolVersion;
            this.isConnected = true;
            
            this.log(`Connected to device: ${this.deviceInfo}`);
            
            return this.deviceInfo;
            
        } catch (error) {
            log(`Connection failed: ${error.message}`, 'error');
            throw error;
        }
    }
    
    /**
     * Disconnect from device
     */
    async disconnectDevice() {
        if (this.downloadEngine) {
            await this.downloadEngine.closeConnection();
        }
        
        if (this.usbDevice) {
            await this.usbDevice.disconnect();
        }
        
        this.isConnected = false;
        this.log("Disconnected from device");
    }
    
    /**
     * Load and parse firmware file
     */
    async loadFirmware(file, verifyHash = true) {
        this.log(`Loading firmware: ${file.name}`);
        
        const firmwareData = await this.firmwareParser.parse(file, verifyHash);
        
        this.log(`Loaded ${firmwareData.items.length} firmware items`);
        
        return firmwareData;
    }
    
    /**
     * Load and parse PIT file
     */
    async loadPit(pitData) {
        this.log(`Loading PIT...`);
        
        const pit = this.pitParser.parse(pitData);
        
        this.log(`Loaded PIT with ${pit.entries.length} entries`);
        
        return pit;
    }
    
    /**
     * Flash firmware to device
     */
    async flash(firmwareData, pitData = null, reboot = true, progressCallback = null) {
        if (!this.isConnected) {
            throw new Error("Not connected to device");
        }
        
        if (!this.downloadEngine) {
            throw new Error("Download engine not initialized");
        }
        
        this.log("Starting firmware flash...");
        
        // Set progress callback
        if (progressCallback) {
            this.downloadEngine.setProgressCallback(progressCallback);
        }
        
        try {
            // Calculate ACTUAL total bytes (like PyOdin line 330-348)
            // CRITICAL: For compressed files, we decompress BEFORE sending, 
            // so totalBytes must reflect DECOMPRESSED sizes
            this.log("Calculating total bytes to send...");
            let totalBytes = 0;
            
            for (const item of firmwareData.items) {
                // Skip metadata
                if (item.filename.includes('meta-data/') || item.filename.endsWith('.zip')) {
                    continue;
                }
                
                // CRITICAL: For streaming files, we need to calculate their DECOMPRESSED size
                if (!item.data && item.info.isLargeFile) {
                    // Large file that will be loaded during transfer
                    // For compressed files, estimate decompressed size (typically 3-4x for LZ4)
                    if (item.filename.endsWith('.lz4')) {
                        const estimatedSize = item.info.actualSize * 4;  // LZ4 typically 25% compression
                        totalBytes += estimatedSize;
                        this.log(`  ${item.filename}: ${formatBytes(estimatedSize)} (estimated from LZ4)`);
                    } else if (item.filename.endsWith('.gz')) {
                        const estimatedSize = item.info.actualSize * 3;  // GZIP typically 33% compression
                        totalBytes += estimatedSize;
                        this.log(`  ${item.filename}: ${formatBytes(estimatedSize)} (estimated from GZIP)`);
                    } else {
                        // Uncompressed - use actual size
                        totalBytes += item.info.actualSize;
                        this.log(`  ${item.filename}: ${formatBytes(item.info.actualSize)} (uncompressed)`);
                    }
                } else if (item.data) {
                    // Already loaded - use actual size
                    totalBytes += item.data.length;
                    this.log(`  ${item.filename}: ${formatBytes(item.data.length)}`);
                } else {
                    this.log(`  Skipping ${item.filename} (no data)`);
                }
            }
            
            this.log(`Total bytes to send: ${formatBytes(totalBytes)}`);
            
            // Send 100/2 with total bytes
            this.log("Completing initialization (100/2 with total bytes)...");
            this.log(`  PACKET 100/2 HEX (first 64 bytes):`);
            const buf = new Uint8Array(1024);
            buf.set(structPack('<II', 100, 2), 0);
            buf.set(structPack('<Q', totalBytes), 8);
            
            const hexStr = bytesToHex(buf.slice(0, 64));
            for (let i = 0; i < hexStr.length; i += 32) {
                this.log(`    ${String(i/2).padStart(4, '0')}: ${hexStr.slice(i, i+32)}`);
            }
            
            await this.downloadEngine.usbDevice.write(buf.slice(0, this.downloadEngine.packetSize));
            
            const resp = await this.downloadEngine.usbDevice.read(64, TIMEOUT_TRANSFER);
            if (resp.length < 8) {
                throw new Error("No response to 100/2 packet");
            }
            const [respCmd, respData] = structUnpack('<II', resp);
            if (respCmd !== 100 || respData !== 0) {
                throw new Error(`Device rejected 100/2: cmd=${respCmd}, result=${respData}`);
            }
            this.log("✓ Initialization complete");
            
            // Handle PIT
            let pitForMatching = null;
            const protocolVersion = this.deviceInfo?.protocolVersion || 2;
            this.log(`Device protocol version: ${protocolVersion}`);
            
            if (protocolVersion <= 3) {
                this.log("Protocol v2/v3 detected - will retrieve PIT...");
                
                // Send PIT info
                this.log("Calling sendPitInfo...");
                if (!await this.downloadEngine.sendPitInfo()) {
                    throw new Error("sendPitInfo failed");
                }
                
                // Send PIT data if available
                if (pitData) {
                    this.log("Sending PIT data...");
                    if (!await this.downloadEngine.sendPitData(pitData)) {
                        throw new Error("Failed to send PIT data");
                    }
                    pitForMatching = pitData;
                } else if (firmwareData.pitData) {
                    this.log("Sending embedded PIT data...");
                    if (!await this.downloadEngine.sendPitData(firmwareData.pitData)) {
                        throw new Error("Failed to send embedded PIT data");
                    }
                    pitForMatching = firmwareData.pitData;
                }
                
                // Receive PIT from device
                this.log("Receiving PIT from device...");
                try {
                    pitForMatching = await this.downloadEngine.receivePitData();
                    this.log(`✓ Retrieved PIT (${pitForMatching.length} bytes)`);
                } catch (error) {
                    this.log(`ERROR: Could not retrieve PIT: ${error.message}`);
                    throw error;
                }
            } else {
                // Protocol v4+ may not need PIT
                if (pitData) {
                    this.log("Sending PIT data...");
                    if (!await this.downloadEngine.sendPitData(pitData)) {
                        throw new Error("Failed to send PIT data");
                    }
                    pitForMatching = pitData;
                } else if (firmwareData.pitData) {
                    this.log("Sending embedded PIT data...");
                    if (!await this.downloadEngine.sendPitData(firmwareData.pitData)) {
                        throw new Error("Failed to send embedded PIT data");
                    }
                    pitForMatching = firmwareData.pitData;
                }
            }
            
            // Upload firmware binaries
            this.log("Uploading firmware binaries...");
            if (!await this.downloadEngine.uploadBinaries(firmwareData, pitForMatching)) {
                throw new Error("Failed to upload firmware binaries");
            }
            
            this.log("Firmware flashed successfully!");
            
            // Close session
            this.log("Closing session...");
            try {
                await this.downloadEngine.closeConnection();
                await sleep(500);
            } catch (error) {
                this.log(`Warning: Error closing connection: ${error.message}`);
            }
            
            // Reboot device if requested
            if (reboot) {
                this.log("Rebooting device...");
                try {
                    await this.downloadEngine.rebootDevice();
                    await sleep(1000);
                } catch (error) {
                    // Device disconnects during reboot - this is normal
                }
            }
            
            return true;
            
        } catch (error) {
            this.log(`Flashing failed: ${error.message}`);
            throw error;
        }
    }
    
    /**
     * Dump PIT from device
     */
    async dumpPit() {
        if (!this.isConnected) {
            throw new Error("Not connected to device");
        }
        
        if (!this.downloadEngine) {
            throw new Error("Download engine not initialized");
        }
        
        this.log("Dumping PIT from device...");
        
        const pitData = await this.downloadEngine.receivePitData();
        
        this.log(`PIT dumped successfully (${pitData.length} bytes)`);
        
        return pitData;
    }
    
    /**
     * Get connected device information
     */
    getDeviceInfo() {
        return this.deviceInfo;
    }
}

