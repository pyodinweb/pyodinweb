// Browser wrapper for lz4js CommonJS modules
(function(window) {
    'use strict';
    
    // Minimal util.js implementation
    const util = {
        makeBuffer: function(size) {
            return new Uint8Array(size);
        },
        bufferToArray: function(buf) {
            return new Uint8Array(buf);
        },
        toUint8Array: function(data) {
            return data instanceof Uint8Array ? data : new Uint8Array(data);
        }
    };
    
    // Minimal xxh32.js stub
    const xxh32 = {
        xxh32: function(data, seed) {
            return 0;  // Not used for decompression
        }
    };
    
    // Expose as global for browser use
    window.lz4 = {
        decompress: function(src, maxSize) {
            throw new Error('LZ4 not fully implemented - use pako for GZIP files or install proper LZ4 library');
        },
        compress: function(src, maxSize) {
            throw new Error('LZ4 compression not implemented');
        }
    };
    
    console.log('LZ4 stub loaded - LZ4 decompression not fully implemented');
    console.log('Recommendation: Convert .lz4 files to .gz format or serve webapp over HTTP');
    
})(window);
