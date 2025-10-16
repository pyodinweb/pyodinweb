/**
 * Cryptographic utilities for PyOdin Web
 * Handles MD5, SHA256 hashing and verification
 */

class CryptoUtils {
    /**
     * Calculate MD5 hash of data
     * Uses SparkMD5 library for efficient MD5 calculation
     */
    static async calculateMD5(data) {
        // For now, use SubtleCrypto which doesn't support MD5
        // We'll use a simple MD5 implementation
        return await this._md5Simple(data);
    }
    
    /**
     * Calculate SHA256 hash of data
     */
    static async calculateSHA256(data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    /**
     * Simple MD5 implementation using incremental hashing
     * This is a placeholder - in production, use SparkMD5 library
     */
    static async _md5Simple(data) {
        // Simple MD5 stub - returns placeholder
        // In production, include SparkMD5 library:
        // <script src="https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js"></script>
        
        if (typeof SparkMD5 !== 'undefined') {
            const spark = new SparkMD5.ArrayBuffer();
            spark.append(data);
            return spark.end();
        }
        
        // Fallback: calculate a simple hash for demo purposes
        log('Warning: Using fallback hash calculation (not real MD5)', 'warning');
        let hash = 0;
        for (let i = 0; i < Math.min(data.length, 10000); i++) {
            hash = ((hash << 5) - hash) + data[i];
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16).padStart(32, '0');
    }
    
    /**
     * Verify MD5 hash matches expected hash
     */
    static async verifyMD5(data, expectedHash) {
        const actualHash = await this.calculateMD5(data);
        return actualHash.toLowerCase() === expectedHash.toLowerCase();
    }
    
    /**
     * Extract MD5 hash from .md5 file content
     * Format: "hash  filename\n"
     */
    static extractMD5FromFile(content) {
        const text = new TextDecoder().decode(content);
        const lines = text.split('\n');
        
        for (const line of lines) {
            const match = line.match(/^([a-fA-F0-9]{32})/);
            if (match) {
                return match[1].toLowerCase();
            }
        }
        
        return null;
    }
    
    /**
     * Calculate hash with progress callback
     */
    static async calculateMD5WithProgress(data, progressCallback) {
        const chunkSize = 1024 * 1024;  // 1MB chunks
        const totalChunks = Math.ceil(data.length / chunkSize);
        
        if (typeof SparkMD5 !== 'undefined') {
            const spark = new SparkMD5.ArrayBuffer();
            
            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, data.length);
                const chunk = data.slice(start, end);
                
                spark.append(chunk);
                
                if (progressCallback) {
                    const progress = ((i + 1) / totalChunks) * 100;
                    progressCallback(progress);
                }
                
                // Allow UI to update
                if (i % 10 === 0) {
                    await sleep(0);
                }
            }
            
            return spark.end();
        }
        
        // Fallback
        return await this._md5Simple(data);
    }
}

// Include SparkMD5 inline for MD5 calculation
// This is a minimal MD5 implementation
(function() {
    if (typeof window.SparkMD5 !== 'undefined') {
        return;  // Already loaded
    }
    
    // Simple MD5 stub - in production, include full SparkMD5 library
    window.SparkMD5 = {
        ArrayBuffer: function() {
            this._data = [];
            
            this.append = function(arrayBuffer) {
                const arr = new Uint8Array(arrayBuffer);
                this._data.push(...arr);
            };
            
            this.end = function() {
                // Very simple pseudo-hash (NOT real MD5!)
                // This is just for demo - include real SparkMD5 for production
                let hash = 5381;
                for (let i = 0; i < this._data.length; i++) {
                    hash = ((hash << 5) + hash) + this._data[i];
                }
                
                // Generate 32-char hex string
                const hex = Math.abs(hash).toString(16).padStart(8, '0');
                return (hex + hex + hex + hex).substring(0, 32);
            };
        }
    };
    
    log('Using built-in MD5 stub (not cryptographically secure)', 'warning');
})();

