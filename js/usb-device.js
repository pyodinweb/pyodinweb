/**
 * USB device communication for Samsung devices using WebUSB
 * Port of PyOdin's usb_device.py
 */

class DeviceInfo {
    constructor(vendorId, productId) {
        this.vendorId = vendorId;
        this.productId = productId;
        this.manufacturer = "";
        this.product = "";
        this.serialNumber = "";
        
        // Device-specific info from Odin protocol
        this.protocolVersion = 0;
        this.deviceId = "";
        this.modelName = "";
        this.firmwareVersion = "";
        this.chipId = "";
        this.supportsZlp = false;
    }
    
    toString() {
        return `DeviceInfo(product='${this.product}', model='${this.modelName}', serial='${this.serialNumber}')`;
    }
}

class UsbDevice {
    constructor(verbose = false) {
        this.verbose = verbose;
        this.device = null;
        this.interface = 0;
        this.endpointOut = null;
        this.endpointIn = null;
        this.deviceInfo = null;
        this.packetSize = USB_PACKET_SIZE;
        this.configuration = null;
    }
    
    log(message) {
        if (this.verbose) {
            log(`[UsbDevice] ${message}`, 'info');
        }
    }
    
    /**
     * Find Samsung device in Download mode using WebUSB
     */
    async findDevice() {
        this.log("Searching for Samsung device in Download mode...");
        
        try {
            // Request access to Samsung devices
            const filters = SAMSUNG_DOWNLOAD_MODE_PIDS.map(pid => ({
                vendorId: SAMSUNG_VENDOR_ID,
                productId: pid
            }));
            
            this.device = await navigator.usb.requestDevice({ filters });
            
            if (this.device) {
                this.log(`Found device: VID=0x${this.device.vendorId.toString(16).padStart(4, '0')}, PID=0x${this.device.productId.toString(16).padStart(4, '0')}`);
                
                // Create device info
                this.deviceInfo = new DeviceInfo(
                    this.device.vendorId,
                    this.device.productId
                );
                
                this.deviceInfo.manufacturer = this.device.manufacturerName || "";
                this.deviceInfo.product = this.device.productName || "";
                this.deviceInfo.serialNumber = this.device.serialNumber || "";
                
                return this.deviceInfo;
            }
        } catch (error) {
            log(`Error finding device: ${error.message}`, 'error');
            return null;
        }
        
        return null;
    }
    
    /**
     * Connect to USB device and configure interface
     */
    async connect() {
        if (!this.device) {
            const deviceInfo = await this.findDevice();
            if (!deviceInfo) {
                throw new Error("No Samsung device found in Download mode");
            }
        }
        
        try {
            this.log("Connecting to device...");
            
            // Open device
            await this.device.open();
            this.log("Device opened");
            
            // Select configuration
            if (this.device.configuration === null) {
                await this.device.selectConfiguration(1);
                this.log("Configuration selected");
            }
            
            this.configuration = this.device.configuration;
            this.log(`Active configuration: ${this.configuration.configurationValue}`);
            this.log(`Number of interfaces: ${this.configuration.interfaces.length}`);
            
            // Find endpoints across all interfaces
            this.log("Searching for endpoints across all interfaces...");
            
            for (const iface of this.configuration.interfaces) {
                this.log(`Interface ${iface.interfaceNumber}: Class=${iface.alternate.interfaceClass}`);
                
                // Claim interface if it has endpoints
                if (iface.alternate.endpoints.length > 0) {
                    try {
                        await this.device.claimInterface(iface.interfaceNumber);
                        this.log(`  Claimed interface ${iface.interfaceNumber}`);
                    } catch (error) {
                        this.log(`  Warning: Could not claim interface: ${error.message}`);
                    }
                }
                
                // Check all endpoints
                for (const endpoint of iface.alternate.endpoints) {
                    const direction = endpoint.direction;  // 'in' or 'out'
                    const type = endpoint.type;  // 'bulk', 'interrupt', etc.
                    
                    this.log(`    Endpoint 0x${endpoint.endpointNumber.toString(16).padStart(2, '0')}: ${type} ${direction}`);
                    
                    // Look for bulk endpoints
                    if (type === 'bulk') {
                        if (direction === 'out' && !this.endpointOut) {
                            this.endpointOut = endpoint;
                            this.interface = iface.interfaceNumber;
                            this.log(`      ★ Using as OUT endpoint`);
                        } else if (direction === 'in' && !this.endpointIn) {
                            this.endpointIn = endpoint;
                            this.interface = iface.interfaceNumber;
                            this.log(`      ★ Using as IN endpoint`);
                        }
                    }
                }
            }
            
            if (!this.endpointOut || !this.endpointIn) {
                throw new Error(`Could not find USB endpoints. Found OUT: ${!!this.endpointOut}, Found IN: ${!!this.endpointIn}`);
            }
            
            this.log(`✓ Endpoints configured:`);
            this.log(`  OUT: 0x${this.endpointOut.endpointNumber.toString(16).padStart(2, '0')}`);
            this.log(`  IN:  0x${this.endpointIn.endpointNumber.toString(16).padStart(2, '0')}`);
            
            // Get packet size
            this.packetSize = this.endpointOut.packetSize;
            this.log(`Max packet size: ${this.packetSize}`);
            
            return true;
            
        } catch (error) {
            throw new Error(`USB connection failed: ${error.message}`);
        }
    }
    
    /**
     * Disconnect from USB device
     */
    async disconnect() {
        if (this.device) {
            try {
                // Release interface
                if (this.interface !== null) {
                    await this.device.releaseInterface(this.interface);
                }
                
                // Close device
                await this.device.close();
                this.log("Disconnected from device");
            } catch (error) {
                this.log(`Warning during disconnect: ${error.message}`);
            }
        }
        
        this.device = null;
        this.endpointOut = null;
        this.endpointIn = null;
    }
    
    /**
     * Write data to device
     * @param {Uint8Array} data - Data to write
     * @param {number} timeout - Timeout in SECONDS
     */
    async write(data, timeout = TIMEOUT_WRITE) {
        if (!this.endpointOut) {
            throw new Error("Device not connected");
        }
        
        try {
            // WebUSB transferOut
            // For large writes, chunk them
            if (data.length > 65536) {
                let totalWritten = 0;
                let offset = 0;
                const chunkSize = 65536;  // 64KB chunks
                
                while (offset < data.length) {
                    const chunkEnd = Math.min(offset + chunkSize, data.length);
                    const chunk = data.slice(offset, chunkEnd);
                    
                    const result = await this.device.transferOut(
                        this.endpointOut.endpointNumber,
                        chunk
                    );
                    
                    totalWritten += result.bytesWritten;
                    offset = chunkEnd;
                    
                    if (result.bytesWritten !== chunk.length) {
                        this.log(`Warning: Partial write ${result.bytesWritten}/${chunk.length} bytes`);
                        break;
                    }
                }
                
                if (this.verbose) {
                    this.log(`Wrote ${totalWritten} bytes (chunked)`);
                }
                
                return totalWritten;
            } else {
                // Small writes
                const result = await this.device.transferOut(
                    this.endpointOut.endpointNumber,
                    data
                );
                
                if (this.verbose) {
                    this.log(`Wrote ${result.bytesWritten} bytes`);
                }
                
                return result.bytesWritten;
            }
            
        } catch (error) {
            throw new Error(`USB write failed: ${error.message}`);
        }
    }
    
    /**
     * Read data from device
     * @param {number} size - Number of bytes to read
     * @param {number} timeout - Timeout in SECONDS (will be converted to ms)
     */
    async read(size, timeout = TIMEOUT_READ) {
        if (!this.endpointIn) {
            throw new Error("Device not connected");
        }
        
        try {
            // Note: WebUSB doesn't directly support timeouts, so we implement one
            const timeoutMs = timeout * 1000;
            
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('timeout')), timeoutMs);
            });
            
            const readPromise = this.device.transferIn(
                this.endpointIn.endpointNumber,
                size
            );
            
            const result = await Promise.race([readPromise, timeoutPromise]);
            
            if (this.verbose) {
                this.log(`Read ${result.data.byteLength} bytes`);
            }
            
            return new Uint8Array(result.data.buffer);
            
        } catch (error) {
            if (error.message === 'timeout') {
                throw new Error(`USB read timeout after ${timeout}s`);
            }
            throw new Error(`USB read failed: ${error.message}`);
        }
    }
    
    /**
     * Bulk write data
     */
    async bulkWrite(data, timeout = TIMEOUT_WRITE) {
        let totalWritten = 0;
        let offset = 0;
        
        while (offset < data.length) {
            const chunkSize = Math.min(this.packetSize, data.length - offset);
            const chunk = data.slice(offset, offset + chunkSize);
            
            const written = await this.write(chunk, timeout);
            totalWritten += written;
            offset += chunkSize;
            
            if (this.verbose && totalWritten % (this.packetSize * 100) === 0) {
                this.log(`Bulk write progress: ${totalWritten}/${data.length} bytes`);
            }
        }
        
        return totalWritten;
    }
    
    /**
     * Bulk read data
     */
    async bulkRead(size, timeout = TIMEOUT_READ) {
        const chunks = [];
        let totalRead = 0;
        
        while (totalRead < size) {
            const remaining = size - totalRead;
            const chunkSize = Math.min(this.packetSize, remaining);
            
            const chunk = await this.read(chunkSize, timeout);
            chunks.push(chunk);
            totalRead += chunk.length;
            
            if (this.verbose && totalRead % (this.packetSize * 100) === 0) {
                this.log(`Bulk read progress: ${totalRead}/${size} bytes`);
            }
        }
        
        return concatUint8Arrays(...chunks);
    }
    
    /**
     * Control transfer
     */
    async controlTransfer(requestType, request, value = 0, index = 0, data = null, timeout = TIMEOUT_WRITE) {
        if (!this.device) {
            throw new Error("Device not connected");
        }
        
        try {
            if (data !== null) {
                // OUT transfer
                const result = await this.device.controlTransferOut({
                    requestType: requestType,
                    recipient: 'device',
                    request: request,
                    value: value,
                    index: index
                }, data);
                
                return new Uint8Array(0);
            } else {
                // IN transfer
                const result = await this.device.controlTransferIn({
                    requestType: requestType,
                    recipient: 'device',
                    request: request,
                    value: value,
                    index: index
                }, 1024);
                
                return new Uint8Array(result.data.buffer);
            }
        } catch (error) {
            throw new Error(`Control transfer failed: ${error.message}`);
        }
    }
    
    /**
     * Reset USB device
     */
    async reset() {
        if (this.device) {
            try {
                await this.device.reset();
                this.log("Device reset");
            } catch (error) {
                throw new Error(`Device reset failed: ${error.message}`);
            }
        }
    }
    
    /**
     * List all Samsung devices in Download mode
     */
    static async listDevices() {
        const devices = await navigator.usb.getDevices();
        const samsungDevices = [];
        
        for (const device of devices) {
            if (device.vendorId === SAMSUNG_VENDOR_ID && 
                SAMSUNG_DOWNLOAD_MODE_PIDS.includes(device.productId)) {
                
                const deviceInfo = new DeviceInfo(
                    device.vendorId,
                    device.productId
                );
                
                deviceInfo.manufacturer = device.manufacturerName || "";
                deviceInfo.product = device.productName || "";
                deviceInfo.serialNumber = device.serialNumber || "";
                
                samsungDevices.push(deviceInfo);
            }
        }
        
        return samsungDevices;
    }
}

