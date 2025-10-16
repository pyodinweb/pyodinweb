/**
 * Wrapper to expose bundled LZ4 library to global scope
 * The lz4.min.js uses CommonJS but doesn't auto-expose globals
 */

// After lz4.min.js loads, the 'lz4' module should be in the require cache
// We need to extract it and expose it globally

(function() {
    try {
        // The browserified bundle creates a require function
        // Try to access the lz4 module from it
        if (typeof require !== 'undefined' && typeof require.cache === 'object') {
            const lz4Module = require('lz4');
            if (lz4Module) {
                window.lz4 = lz4Module;
                console.log('LZ4 library exposed to window.lz4');
                return;
            }
        }
        
        // Fallback: try direct require
        if (typeof require !== 'undefined') {
            try {
                window.lz4 = require('lz4');
                console.log('LZ4 loaded via require("lz4")');
                return;
            } catch (e) {
                console.error('require("lz4") failed:', e.message);
            }
        }
        
        console.error('Could not expose LZ4 library - require not available');
        
    } catch (error) {
        console.error('LZ4 wrapper error:', error.message);
    }
})();

