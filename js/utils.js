/**
 * Utility functions for PyOdin Web
 */

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Log message to console and UI
 */
function log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const fullMessage = `[${timestamp}] ${message}`;
    
    console.log(fullMessage);
    
    // Add to UI log
    const logContainer = document.getElementById('log-container');
    if (logContainer) {
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = fullMessage;
        logContainer.appendChild(logEntry);
        
        // Auto-scroll to bottom
        logContainer.scrollTop = logContainer.scrollHeight;
        
        // Limit log entries to 100
        while (logContainer.children.length > 100) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }
}

/**
 * Update progress bar
 */
function updateProgress(percentage, message) {
    const progressFill = document.getElementById('progress-fill');
    const progressInfo = document.getElementById('progress-info');
    
    if (progressFill) {
        progressFill.style.width = `${percentage}%`;
        progressFill.textContent = `${percentage.toFixed(1)}%`;
    }
    
    if (progressInfo && message) {
        progressInfo.textContent = message;
    }
}

/**
 * Compare byte arrays
 */
function arrayEquals(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Check if array starts with pattern
 */
function arrayStartsWith(array, pattern) {
    if (array.length < pattern.length) return false;
    for (let i = 0; i < pattern.length; i++) {
        if (array[i] !== pattern[i]) return false;
    }
    return true;
}

/**
 * Convert number to little-endian bytes
 */
function numberToLE(num, bytes = 4) {
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < bytes; i++) {
        arr[i] = (num >> (i * 8)) & 0xFF;
    }
    return arr;
}

/**
 * Convert little-endian bytes to number
 */
function LEToNumber(arr, offset = 0, bytes = 4) {
    let num = 0;
    for (let i = 0; i < bytes; i++) {
        num |= arr[offset + i] << (i * 8);
    }
    return num >>> 0;  // Convert to unsigned
}

/**
 * Pack values into buffer (Python struct.pack equivalent)
 */
function structPack(format, ...values) {
    // Simple implementation for common formats
    // format: '<' = little-endian, 'I' = uint32, 'Q' = uint64
    const buffer = [];
    let valueIndex = 0;
    
    let littleEndian = true;
    if (format[0] === '<') {
        format = format.slice(1);
    } else if (format[0] === '>') {
        littleEndian = false;
        format = format.slice(1);
    }
    
    for (let i = 0; i < format.length; i++) {
        const type = format[i];
        const value = values[valueIndex++];
        
        if (type === 'I') {  // uint32
            const bytes = numberToLE(value, 4);
            buffer.push(...bytes);
        } else if (type === 'Q') {  // uint64
            const low = value & 0xFFFFFFFF;
            const high = Math.floor(value / 0x100000000);
            const bytes = [...numberToLE(low, 4), ...numberToLE(high, 4)];
            buffer.push(...bytes);
        } else if (type === 'H') {  // uint16
            const bytes = numberToLE(value, 2);
            buffer.push(...bytes);
        } else if (type === 'B') {  // uint8
            buffer.push(value & 0xFF);
        }
    }
    
    return new Uint8Array(buffer);
}

/**
 * Unpack values from buffer (Python struct.unpack equivalent)
 */
function structUnpack(format, buffer, offset = 0) {
    const values = [];
    
    let littleEndian = true;
    if (format[0] === '<') {
        format = format.slice(1);
    } else if (format[0] === '>') {
        littleEndian = false;
        format = format.slice(1);
    }
    
    let pos = offset;
    for (let i = 0; i < format.length; i++) {
        const type = format[i];
        
        if (type === 'I') {  // uint32
            values.push(LEToNumber(buffer, pos, 4));
            pos += 4;
        } else if (type === 'Q') {  // uint64
            const low = LEToNumber(buffer, pos, 4);
            const high = LEToNumber(buffer, pos + 4, 4);
            values.push(low + high * 0x100000000);
            pos += 8;
        } else if (type === 'H') {  // uint16
            values.push(LEToNumber(buffer, pos, 2));
            pos += 2;
        } else if (type === 'B') {  // uint8
            values.push(buffer[pos]);
            pos += 1;
        }
    }
    
    return values;
}

/**
 * Concatenate Uint8Arrays
 */
function concatUint8Arrays(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Read string from Uint8Array (null-terminated or fixed length)
 */
function readString(buffer, offset, maxLength) {
    let str = '';
    for (let i = 0; i < maxLength; i++) {
        const byte = buffer[offset + i];
        if (byte === 0) break;
        str += String.fromCharCode(byte);
    }
    return str;
}

/**
 * Create a zero-filled buffer
 */
function createZeroBuffer(size) {
    return new Uint8Array(size);
}

/**
 * Show error dialog
 */
function showError(message) {
    log(message, 'error');
    alert('Error: ' + message);
}

/**
 * Show success message
 */
function showSuccess(message) {
    log(message, 'success');
}

/**
 * Check WebUSB support
 */
function checkWebUSBSupport() {
    if (!navigator.usb) {
        document.getElementById('webusb-warning').classList.remove('hidden');
        return false;
    }
    return true;
}

/**
 * Detect compression type from data
 */
function detectCompressionType(data) {
    if (arrayStartsWith(data, GZIP_SIGNATURE)) {
        return 'gzip';
    } else if (arrayStartsWith(data, LZ4_SIGNATURE)) {
        return 'lz4';
    }
    return 'none';
}

/**
 * Detect file type from filename and content
 */
function detectFileType(filename, data) {
    filename = filename.toLowerCase();
    
    // Check by extension first
    if (filename.endsWith('.tar.md5') || filename.endsWith('.tar')) {
        return 'tar';
    } else if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) {
        return 'tar.gz';
    } else if (filename.endsWith('.bin')) {
        return 'bin';
    } else if (filename.endsWith('.img')) {
        return 'img';
    }
    
    // Check by content
    if (data) {
        const compression = detectCompressionType(data);
        if (compression === 'gzip') {
            return 'tar.gz';
        }
        // Check for TAR signature at offset 257
        if (data.length > 262 && arrayStartsWith(data.subarray(257), TAR_SIGNATURE)) {
            return 'tar';
        }
    }
    
    return 'unknown';
}

